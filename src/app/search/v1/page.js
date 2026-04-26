"use client";
import { useState, useEffect } from "react";
import data from "@/../assets/district_data.json";
import axios from "axios";

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
    const [error, setError] = useState("");
    const [searchResults, setSearchResults] = useState([]);

    useEffect(() => {
        const selectedState = states.find(s => s.stateCode === stateCode);

        if (selectedState) {
            setDistricts(selectedState.districts);
            setDistrictCode("");
        } else {
            setDistricts([]);
        }
    }, [stateCode, states]);

    const handleSearch = async (stateCode, districtCode, bloodComponentId, bloodGroupId) => {
        setLoading(true);
        const params = new URLSearchParams();
        if (stateCode) params.append("stateCode", stateCode);
        else {
            alert("Please select a state.");
            return;
        }
        if (districtCode) params.append("districtCode", districtCode);
        if (bloodComponentId) params.append("ComponentId", bloodComponentId);
        if (bloodGroupId) params.append("bloodGroupId", bloodGroupId);
        console.log(params.toString());
        const response = await axios.get(`/api/search?${params.toString()}`, {});
        console.log(response.data.length);
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
            <select
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
            <select
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
            <select
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

            {districts.length > 0 && (
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


            <button className="bg-blue-500 text-white px-4 py-2 rounded disabled:bg-gray-400"
                disabled={!stateCode}
                onClick={() => handleSearch(stateCode, districtCode, bloodComponentId, bloodGroupId)}
            >
                Search
            </button>
            {loaded && (
                <div>
                    {/* Render search results here */}

                </div>
            )}
        </div>
    );
}