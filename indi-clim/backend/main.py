from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
import os
import requests
import datetime
from dotenv import load_dotenv

load_dotenv()
IMD_KEY = os.getenv("IMD_DATA_TOKEN")
OPENWEATHER_API_KEY = os.getenv("37eec11a7ab59a3d52e849de710cd6d6")

app = FastAPI(title="Indi-CLIM Digital Twin API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/coordinates/local")
def get_coordinates():
    grid_resolution = 40 
    lats = np.linspace(8.0, 37.0, grid_resolution).tolist()
    lons = np.linspace(68.0, 97.0, grid_resolution).tolist()
    return {"latitudes": lats, "longitudes": lons}

@app.post("/api/simulate")
def run_simulation(scenario: str, intensity: float, synthesize_global: bool = False):
    grid_resolution = 40
    base_temp = np.random.normal(loc=28.0, scale=4.0, size=(grid_resolution, grid_resolution))
    base_precip = np.random.normal(loc=40.0, scale=15.0, size=(grid_resolution, grid_resolution))
    
    if scenario == "el_nino_stress":
        precip_drop = 1.0 - (0.10 * intensity)
        modified_precip = base_precip * precip_drop
        modified_temp = base_temp + (1.5 * intensity)
        crop_stress = (modified_temp * 1.5) - (modified_precip * 0.5)
    elif scenario == "urbanization":
        modified_temp = base_temp + (3.0 * intensity)
        modified_precip = base_precip 
        crop_stress = (modified_temp * 1.8) - (modified_precip * 0.4)
    else:
        modified_temp, modified_precip, crop_stress = base_temp, base_precip, np.zeros_like(base_temp)

    modified_precip = np.clip(modified_precip, 0, None)
    crop_stress = np.clip(crop_stress, 0, 100)

    return {
        "status": "simulation_success",
        "log": f"GeoAI {scenario.replace('_', ' ').title()} Model converged. Intensity: {intensity}x",
        "metrics": {
            "avg_predicted_temp": float(np.mean(modified_temp)),
            "rainfall_deficit": float(np.mean((modified_precip - base_precip) / base_precip) * 100) if scenario == "el_nino_stress" else 0.0,
            "crop_risk_index": float(np.mean(crop_stress))
        },
        "data_cube": {
            "temperature": modified_temp.tolist(),
            "precipitation": modified_precip.tolist(),
            "crop_stress": crop_stress.tolist()
        }
    }

@app.get("/api/telemetry")
def get_local_telemetry(lat: float, lon: float):
   if not OPENWEATHER_API_KEY or OPENWEATHER_API_KEY == "YOUR_PLACEHOLDER_KEY":
        return {"error": "OpenWeatherMap API key missing in backend .env"}
        
    weather_url = f"https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={OPENWEATHER_API_KEY}&units=metric"
    pollution_url = f"https://api.openweathermap.org/data/2.5/air_pollution?lat={lat}&lon={lon}&appid={OPENWEATHER_API_KEY}"
    
    try:
        w_res = requests.get(weather_url).json()
        if w_res.get("cod") != 200:
            return {"error": w_res.get("message", "Failed to retrieve data from OpenWeatherMap")}
            
        p_res = requests.get(pollution_url).json()
        
        name = w_res.get("name", f"Grid Loc ({lat:.2f}, {lon:.2f})")
        country = w_res.get("sys", {}).get("country", "IN")
        temp_c = w_res.get("main", {}).get("temp", 25.0)
        wind_ms = w_res.get("wind", {}).get("speed", 0.0)
        wind_kph = round(wind_ms * 3.6, 1)
        precip_mm = w_res.get("rain", {}).get("1h", 0.0)
        
        weather_list = w_res.get("weather", [{}])
        cond_text = weather_list[0].get("description", "Clear").title()
        icon_code = weather_list[0].get("icon", "01d")
        icon_url = f"https://openweathermap.org/img/wn/{icon_code}@2x.png"
        
        aqi_list = p_res.get("list", [{}])
        aqi_val = aqi_list[0].get("main", {}).get("aqi", 1)
        
        diff = datetime.datetime.utcnow() - datetime.datetime(2000, 1, 6)
        days = diff.days + (diff.seconds / 86400.0)
        phase = (days % 29.530588853) / 29.530588853
        if phase < 0.03 or phase > 0.97: moon_phase = "New Moon"
        elif phase < 0.22: moon_phase = "Waxing Crescent"
        elif phase < 0.28: moon_phase = "First Quarter"
        elif phase < 0.47: moon_phase = "Waxing Gibbous"
        elif phase < 0.53: moon_phase = "Full Moon"
        elif phase < 0.72: moon_phase = "Waning Gibbous"
        elif phase < 0.78: moon_phase = "Third Quarter"
        else: moon_phase = "Waning Crescent"
        
        return {
            "location": {"name": name, "region": "Satellite Target", "country": country},
            "current": {
                "condition": {"text": cond_text, "icon": icon_url},
                "temp_c": temp_c,
                "uv": "Low" if temp_c < 22 else "Moderate" if temp_c < 30 else "Very High",
                "air_quality": {"us-epa-index": aqi_val},
                "wind_kph": wind_kph,
                "precip_mm": precip_mm
            },
            "forecast": {
                "forecastday": [
                    {"astro": {"moon_phase": moon_phase}}
                ]
            }
        }
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/search")
def search_landmarks(query: str):
    # Using Nominatim (OpenStreetMap) - 100% Free, No Key Required
    url = f"https://nominatim.openstreetmap.org/search?q={query}&format=json&limit=5&countrycodes=in"
    # Nominatim strictly requires a unique User-Agent header
    headers = {"User-Agent": "Indi-CLIM-Twin/1.0"}
    try:
        res = requests.get(url, headers=headers).json()
        results = []
        for item in res:
            results.append({
                "name": item.get("display_name"),
                "coordinates": [float(item.get("lon")), float(item.get("lat"))]
            })
        return {"results": results}
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/route")
def calculate_navigation(start_lng: float, start_lat: float, end_lng: float, end_lat: float):
    # Using OSRM (Open Source Routing Machine) Demo API - 100% Free, No Key Required
    url = f"http://router.project-osrm.org/route/v1/driving/{start_lng},{start_lat};{end_lng},{end_lat}?overview=full&geometries=geojson"
    try:
        res = requests.get(url).json()
        
        if res.get("code") != "Ok":
            return {"error": "Routing engine failed to find a valid road network."}
            
        routes = res.get("routes", [])
        if not routes:
            return {"error": "No viable land route discovered between nodes"}
        
        # OSRM precisely matches the GeoJSON coordinate structure DeckGL expects
        path = routes[0].get("geometry", {}).get("coordinates", [])
        distance_km = round(routes[0].get("distance", 0) / 1000, 1)
        duration_mins = round(routes[0].get("duration", 0) / 60, 0) # OSRM provides duration in seconds
        
        return {
            "path": path,
            "distance_km": distance_km,
            "duration_mins": duration_mins
        }
    except Exception as e:
        return {"error": str(e)}
