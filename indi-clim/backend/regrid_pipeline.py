# backend/regrid_pipeline.py
import os
import numpy as np
import xarray as xr


def run_regrid_pipeline(
    input_file="mock_india_climate.nc", output_file="regridded_india_climate.nc"
):
    print(f"Loading raw climate data cube: {input_file}...")

    if not os.path.exists(input_file):
        raise FileNotFoundError(
            f"Source file {input_file} not found. Please run mock_data_generator.py first."
        )

    # Open the dataset using xarray
    # In a production pipeline, chunks={} would automatically trigger Dask parallel execution
    ds_source = xr.open_dataset(input_file, chunks={"time": 10})
    print(f"Original Grid Shape: {ds_source.sizes}")
    print(
        f"Original Lat Resolution: {ds_source.lat.values[1] - ds_source.lat.values[0]} deg"
    )

    # Define our target high-resolution grid (0.25-degree target alignment)
    # Target: Lat (6.0 to 38.0), Lon (68.0 to 98.0)
    target_lats = np.arange(6.0, 38.25, 0.25)
    target_lons = np.arange(68.0, 98.25, 0.25)

    print("Executing Bilinear Spatial Regridding across all time steps...")

    # Perform multidimensional interpolation
    # 'linear' specifies bilinear interpolation across our two spatial coordinates (lat/lon)
    ds_regridded = ds_source.interp(
        lat=target_lats, lon=target_lons, method="linear"
    )

    # Update metadata to reflect the transformation pipeline step
    ds_regridded.attrs["spatial_resolution"] = "0.25 degree (Regridded)"
    ds_regridded.attrs["history"] = (
        "Upsampled from 0.5 deg using Bilinear spatial interpolation."
    )

    print(f"Regridded Grid Shape: {ds_regridded.sizes}")
    print(
        f"New Lat Resolution: {ds_regridded.lat.values[1] - ds_regridded.lat.values[0]} deg"
    )

    # Export the aligned dataset to a new NetCDF file
    print(f"Saving aligned high-res dataset to: {output_file}...")
    ds_regridded.to_netcdf(output_file, format="NETCDF4")
    print("Pipeline Step Complete: Target grid alignment succeeded.")


if __name__ == "__main__":
    run_regrid_pipeline()