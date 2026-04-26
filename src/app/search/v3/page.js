"use client";
import { useState, useEffect } from "react";
import data from "@/../assets/district_data.json";
import axios from "axios";
import "leaflet/dist/leaflet.css";
import { useMapEvents } from 'react-leaflet';
import dynamic from "next/dynamic";

const BloodMap = dynamic(() => import("../../components/Map.js"), { ssr: false });

const bloodComponents = {
    "Whole Blood": 11,
    "Packed Red Blood Cells": 12,
    "Fresh Frozen Plasma": 13,
    "Single Donor Platelet": 14,
    "Platelet Rich Plasma": 16,
    "Cryoprecipitate": 17,
    "Single Donor Plasma": 18,
    "Plasma": 19,
    "Platelet Concentrate": 20,
    "Cryo Poor Plasma": 21,
    "Random Donor Platelets": 23,
    "Sagm Packed Red Blood Cells": 28,
    "Irradiated RBC": 29,
    "Leukoreduced Rbc": 30
};
const bloodGroups = {
    "A-Ve": 12,
    "B+Ve": 13,
    "B-Ve": 14,
    "O+Ve": 15,
    "AB+Ve": 17,
    "AB-Ve": 18,
    "A+Ve": 11,
    "O-Ve": 16,
    "Oh+VE": 22,
    "Oh-VE": 23
};

export default function Search() {
    const states = data.statesWithDistricts;
    const [stateCode, setStateCode] = useState("");
    const [districtCode, setDistrictCode] = useState("");
    const [districts, setDistricts] = useState([]);
    const [bloodComponentId, setBloodComponentId] = useState();
    const [bloodGroupId, setBloodGroupId] = useState("");
    const [loaded, setLoaded] = useState(false);
    const [loading, setLoading] = useState(false);
    const [searchResults, setSearchResults] = useState([]);
    const [coords, setCoords] = useState(null)
    const [error, setError] = useState("")
    const [locationSearchResults, setLocationSearchResults] = useState([]);
    const [customIcon, setCustomIcon] = useState(null);
    const [locationLabel, setLocationLabel] = useState("");

    useEffect(() => {
        const initLeaflet = async () => {
            const L = (await import("leaflet")).default;
            const icon = L.icon({
                iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
                iconSize: [25, 41],
                iconAnchor: [12, 41]
            });
            setCustomIcon(icon);
        };
        initLeaflet();
    }, []);


    useEffect(() => { //update districts when state changes
        const selectedState = states.find(s => s.stateCode === stateCode);

        if (selectedState) {
            setDistricts(selectedState.districts);
            setDistrictCode("");
        } else {
            setDistricts([]);
        }
    }, [stateCode, states]);

    const requestLocation = () => {
        setLoading(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                setLoading(false);
            },
            (err) => {
                setError(err.message);
                setLoading(false);
                alert("Could not get location automatically. Please pick a point on the map.");
            },
            { enableHighAccuracy: true }
        );
    };


    const handleSearchWithLocation = async (bloodComponentId, bloodGroupId) => {
        setLoading(true);
        if (!coords) {
            alert("Failed to get location. Please allow location access and try again.");
            console.log(error);
            return;
        }
        setSearchResults([]);
        const params = new URLSearchParams();
        if (coords.lat) params.append("latitude", coords.lat);
        else {
            alert("Failed to get location. Please allow location access and try again.");
            setLoading(false);
            return;
        }
        if (coords.lng) params.append("longitude", coords.lng);
        const range = { 'urban': [3000,5000,10000], 'rural': [10000, 30000, 90000] };
        const is_urban = true;//logic to be implemented 
        for (let r of (is_urban ? range.urban : range.rural)) {
            params.delete("radius");
            params.append("radius", r);
            console.log(params.toString());
            const response = await axios.get(`/api/nearest?${params.toString()}`, {});
            if (response.status !== 200) {
                alert("Failed to fetch data. Please try again later.");
                setLoading(false);
                return;
            }
            if (response.data.length === 0) {
                console.log(`No results within ${r} meters. Expanding search radius...`);
                continue;
            }
            // if (!bloodComponentId && !bloodGroupId) { //if no filters, show all results from nearest api
            //     setLocationSearchResults(response.data);
            //     break;
            // }
            //getstatecodes unique
            const stateCodes = [...new Set(response.data.map(item => item.stateCode))];
            const hospitalCodes = response.data.map(item => item.hospitalCode);
            if (stateCodes.length === 0) {
                console.log("No statecodes found.");
                continue;
            }
            const nearestMap = new Map(
                response.data.map(item => [String(item.hospitalCode), item])
            );            //filter 
            var filteredResults = [];
            for (let sc of stateCodes) {
                const p2 = new URLSearchParams();
                p2.set("stateCode", sc);
                if (bloodComponentId) p2.append("ComponentId", bloodComponentId);
                if (bloodGroupId) p2.append("bloodGroupId", bloodGroupId);
                const res = await axios.get(`/api/search?${p2.toString()}`, {});
                if (res.status !== 200) {
                    alert("Failed to fetch data. Please try again later.");
                    setLoading(false);
                    return;
                }
                console.log(res.data);
                console.log(response.data);
                const filtered = res.data
                    .filter(item => nearestMap.has(String(item.hospitalCode)))
                    .map(item => {
                        const nearest = nearestMap.get(String(item.hospitalCode));
                        return {
                            ...item,
                            dist: nearest.dist,
                            lat: nearest.latitude,   
                            lng: nearest.longitude,  
                        };
                    });
                filteredResults.push(...filtered);
            }
            if (filteredResults.length === 0) {
                console.log("No results found.");
                continue;
            }
            filteredResults.sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity));
            console.log(filteredResults);
            setLocationSearchResults(filteredResults);
            break;
        }

        //filter ends here
        setLoading(false);
        setLoaded(true);
        // setLocationSearchResults(response.data);
    };

    const handleSearch = async (stateCode, districtCode, bloodComponentId, bloodGroupId) => {
        setLoading(true);
        setLocationSearchResults([]);
        const params = new URLSearchParams();
        if (stateCode) params.append("stateCode", stateCode);
        else {
            setLoading(false);
            alert("Please select a state.");
            return;
        }
        if (districtCode) params.append("districtCode", districtCode);
        if (bloodComponentId) params.append("ComponentId", bloodComponentId);
        if (bloodGroupId) params.append("bloodGroupId", bloodGroupId);
        console.log(params.toString());
        const response = await axios.get(`/api/search?${params.toString()}`, {});
        console.log(response.data);
        setLoading(false);
        if (response.status === 200) {
            //handle the response data as needed
            setLoaded(true);
            setSearchResults(response.data);
        }
        else
            alert("Failed to fetch data. Please try again later.");

    };


    return (
        <div className="flex flex-col gap-4 p-10">
            <select //blood component dropdown
                value={bloodComponentId}
                onChange={(e) => setBloodComponentId(e.target.value)}
            >
                <option value="">Select Blood Component</option>
                {Object.entries(bloodComponents).map(([name, code]) => (
                    <option key={code} value={code}>
                        {name}
                    </option>
                ))}
            </select>
            <select //blood group dropdown
                value={bloodGroupId}
                onChange={(e) => setBloodGroupId(e.target.value)}
            >
                <option value="">Select Blood Group</option>
                {Object.entries(bloodGroups).map(([name, code]) => (
                    <option key={code} value={code}>
                        {name}
                    </option>
                ))}
            </select>
            <select //state dropdown
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value)}
            >
                <option value="">Select State</option>
                {states.map(s => (
                    <option key={s.stateCode} value={s.stateCode}>
                        {s.stateName}
                    </option>
                ))}
            </select>

            {districts.length > 0 && ( //district dropdown, only shown if a state with districts is selected
                <select
                    value={districtCode}
                    onChange={(e) => setDistrictCode(e.target.value)}
                >
                    <option value="">Select District</option>
                    {districts.map(d => (
                        <option key={d.districtCode} value={d.districtCode}>
                            {d.districtName}
                        </option>
                    ))}
                </select>
            )}

            <button className="bg-blue-500 text-white px-4 py-2 rounded disabled:bg-gray-400" //search button, disabled if no state is selected 
                disabled={!stateCode || loading}
                onClick={() => handleSearch(stateCode, districtCode, bloodComponentId, bloodGroupId)}
            >
                Search
            </button>

            <button className="bg-blue-500 text-white px-4 py-2 rounded disabled:bg-gray-400" //search with location button, disabled if location is not available
                disabled={coords === null || error !== "" || loading}
                onClick={() => handleSearchWithLocation(bloodComponentId, bloodGroupId)}
            >
                Search with current location instead
            </button>
            <div className="border rounded-lg overflow-hidden h-[300px] w-full relative">
                <BloodMap
                    coords={coords}
                    setCoords={setCoords}
                    onRequestLocation={requestLocation}
                    loading={loading}
                />

                {/* Manual Refresh Button overlaid on Map */}
                <button
                    onClick={requestLocation}
                    className="absolute top-2 right-2 z-[1000] bg-white p-2 shadow-md rounded text-xs font-bold hover:bg-gray-100"
                >
                    {loading ? "Locating..." : "📍 Use My Precise Location"}
                </button>
            </div>

            {coords && (
                <p className="text-xs text-gray-500">
                    Selected: {round(coords.lat, 4)}, {round(coords.lng, 4)}
                </p>
            )}


            {loaded && searchResults.length === 0 && locationSearchResults.length === 0 && (
                <p>No results found.</p>
            )}
            {loaded && searchResults.length > 0 && (
                <div>
                    <h2 className="text-xl font-bold mb-2">Search Results:</h2>
                    <ul>
                        {searchResults.map((result) => (
                            <li key={result.hospitalCode} className="p-4 border-b">
                                <h3 className="font-bold">{result.hospitalname}</h3>
                                <p className="text-sm text-gray-600">{result.hospitaladd}</p>

                                <div className="mt-2 flex flex-wrap gap-2">
                                    {Object.entries(result.components).map(([name, info]) => {
                                        const isAvailable = info?.available_WithQty && info.available_WithQty.trim() !== "";
                                        return isAvailable ? (
                                            <span key={name} className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs">
                                                <strong>{name}:</strong> {info.available_WithQty}
                                            </span>
                                        ) : null;
                                    })}
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {loaded && locationSearchResults.length > 0 && (
                <div>
                    <h2 className="text-xl font-bold mb-2">Search Results based on location:</h2>
                    <ul>
                        {locationSearchResults.map((result) => (
                            <li key={result.hospitalCode}>{result.hospitalname}<br />{result.hospitaladd}   {round(result.dist / 1000, 2)} km <br />
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {Object.entries(result.components).map(([name, info]) => {
                                        const isAvailable = info?.available_WithQty && info.available_WithQty.trim() !== "";
                                        return isAvailable ? (
                                            <span key={name} className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs">
                                                <strong>{name}:</strong> {info.available_WithQty}
                                            </span>
                                        ) : null;
                                    })}
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
function round(value, decimals) {
    return Number(Math.round(value + 'e' + decimals) + 'e-' + decimals);
}//make inline