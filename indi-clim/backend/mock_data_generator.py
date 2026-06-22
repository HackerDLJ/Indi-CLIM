import numpy as np
import pandas as pd
import xarray as xr

def generate_mock_climate_data(output_path="mock_india_climate.nc"):
    print("Initializing mock climate data generation for India domain...")
    
    # Grid definition (0.5 degree resolution for India)
    lats = np.arange(6.0, 38.5, 0.5)
    lons = np.arange(68.0, 98.5, 0.5)
    times = pd.date_range(start="2026-06-01", periods=30, freq="D")
    
    num_lats = len(lats)
    num_lons = len(lons)
    num_times = len(times)
    
    temp_data = np.zeros((num_times, num_lats, num_lons))
    precip_data = np.zeros((num_times, num_lats, num_lons))
    
    base_temp = 28.0
    
    for t in range(num_times):
        for i, lat in enumerate(lats):
            for j, lon in enumerate(lons):
                # Apply latitude temperature gradient
                lat_effect = (lat - 6.0) * 0.3
                daily_noise = np.random.normal(0, 1.5)
                temp_data[t, i, j] = base_temp - lat_effect + daily_noise
                
                # Check spatial zones for heavy monsoon simulation
                is_west_coast = (72.0 <= lon <= 74.5) and (8.0 <= lat <= 18.0)
                is_north_east = (lon >= 90.0) and (lat >= 22.0)
                
                if is_west_coast:
                    base_rain = np.random.uniform(15.0, 50.0)
                elif is_north_east:
                    base_rain = np.random.uniform(10.0, 40.0)
                else:
                    # Clean, multi-line logic block for generic convective rainfall
                    if np.random.rand() > 0.4:
                        base_rain = np.random.uniform(0.0, 8.0)
                    else:
                        base_rain = 0.0
                    
                precip_data[t, i, j] = base_rain

    # Wrap raw arrays into self-documenting xarray Datasets
    ds = xr.Dataset(
        data_vars={
            "temperature": (["time", "lat", "lon"], temp_data.astype(np.float32)),
            "precipitation": (["time", "lat", "lon"], precip_data.astype(np.float32))
        },
        coords={
            "time": times,
            "lat": lats,
            "lon": lons
        },
        attrs={
            "description": "Mock INSAT/IMD blended climate data cube for India.",
            "spatial_resolution": "0.5 degree",
            "projection": "EPSG:4326 (WGS84)"
        }
    )
    
    ds["temperature"].attrs["units"] = "degC"
    ds["temperature"].attrs["long_name"] = "Surface Air Temperature"
    
    ds["precipitation"].attrs["units"] = "mm/day"
    ds["precipitation"].attrs["long_name"] = "Daily Total Precipitation"
    
    print(f"Exporting data cube to NetCDF at: {output_path}...")
    ds.to_netcdf(output_path, format="NETCDF4")
    print("Success: Mock dataset generated.")

if __name__ == "__main__":
    generate_mock_climate_data()
