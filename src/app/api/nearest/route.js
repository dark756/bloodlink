import { NextResponse } from 'next/server';
import axios from 'axios';


export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const api_url = process.env.NEXT_PUBLIC_API_URL || "https://eraktkosh.mohfw.gov.in/eraktkoshPortal/eraktkosh/";
    if (!queryString) {
        return NextResponse.json({ error: 'No query parameters provided' }, { status: 400 });
    }
    try {
        console.log(`${api_url}bloodbank/nearest?${queryString}`)
        const response = await axios.get(
            `${api_url}bloodbank/nearest?${queryString}`,
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Accept': 'application/json',
                }
            }
        );
        console.log(response.data.length);  
        return NextResponse.json(response.data);
    } catch (error) {
        console.log('Error fetching data:', error);
        return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
    }
}
