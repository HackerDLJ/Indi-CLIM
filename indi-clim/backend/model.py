import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
import xarray as xr
import numpy as np

# -------------------------------------------------------------------------
# 1. DATASET LOADER (NetCDF to PyTorch Tensors)
# -------------------------------------------------------------------------
class ClimateDataset(Dataset):
    def __init__(self, file_path="regridded_india_climate.nc"):
        self.ds = xr.open_dataset(file_path)
        
        self.temp = self.ds["temperature"].values
        self.precip = self.ds["precipitation"].values
        
        # Z-score Normalization parameters for training stability
        self.temp_mean, self.temp_std = self.temp.mean(), self.temp.std()
        self.precip_mean, self.precip_std = self.precip.mean(), self.precip.std()
        
        self.norm_temp = (self.temp - self.temp_mean) / (self.temp_std + 1e-5)
        self.norm_precip = (self.precip - self.precip_mean) / (self.precip_std + 1e-5)
        
        # Stack variables along a new channel dimension -> [Time, Channels=2, Lat, Lon]
        self.data = np.stack([self.norm_temp, self.norm_precip], axis=1)
        
    def __len__(self):
        return self.data.shape[0] - 1
        
    def __getitem__(self, idx):
        x = self.data[idx]
        y = self.data[idx + 1]
        
        # Crop 129x121 down to 128x120 cleanly to prevent spatial shape mismatch in U-Net skip layers
        x_cropped = x[:, :128, :120]
        y_cropped = y[:, :128, :120]
        
        return torch.tensor(x_cropped, dtype=torch.float32), torch.tensor(y_cropped, dtype=torch.float32)

# -------------------------------------------------------------------------
# 2. PHYSICS-INFORMED LOSS LAYER
# -------------------------------------------------------------------------
class PhysicsInformedLoss(nn.Module):
    def __init__(self, lambda_physics=0.01):
        super(PhysicsInformedLoss, self).__init__()
        self.lambda_physics = lambda_physics
        
        # Fixed 2D Convolutional Laplacian filter kernel for 5-point discrete finite differences
        laplacian_kernel = torch.tensor([[0.0,  1.0, 0.0],
                                         [1.0, -4.0, 1.0],
                                         [0.0,  1.0, 0.0]], dtype=torch.float32).unsqueeze(0).unsqueeze(0)
        
        self.register_buffer('laplacian_filter', laplacian_kernel)
        
    def forward(self, predictions, targets):
        # Data-driven Mean Squared Error Loss
        mse_loss = F.mse_loss(predictions, targets)
        
        # Isolate Temperature Channel (Channel 0) to evaluate fluid thermal diffusion
        pred_temp = predictions[:, 0:1, :, :]
        
        # Calculate spatial Laplacian across batch using 2D conv
        spatial_laplacian = F.conv2d(pred_temp, self.laplacian_filter, padding=1)
        physics_penalty = torch.mean(spatial_laplacian ** 2)
        
        total_loss = mse_loss + (self.lambda_physics * physics_penalty)
        return total_loss, mse_loss, physics_penalty

# -------------------------------------------------------------------------
# 3. AI ARCHITECTURE: CLIMATE U-NET
# -------------------------------------------------------------------------
class ClimateUNet(nn.Module):
    def __init__(self):
        super(ClimateUNet, self).__init__()
        
        # Encoder (Downsampling) Path
        self.enc1 = nn.Sequential(
            nn.Conv2d(2, 32, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.Conv2d(32, 32, kernel_size=3, padding=1),
            nn.ReLU()
        )
        self.pool1 = nn.MaxPool2d(2, 2) # Output: 64 x 60
        
        self.enc2 = nn.Sequential(
            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.Conv2d(64, 64, kernel_size=3, padding=1),
            nn.ReLU()
        )
        self.pool2 = nn.MaxPool2d(2, 2) # Output: 32 x 30
        
        # Bottleneck (Latent Climate Representation)
        self.bottleneck = nn.Sequential(
            nn.Conv2d(64, 128, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.Conv2d(128, 128, kernel_size=3, padding=1),
            nn.ReLU()
        )
        
        # Decoder (Upsampling) Path with Skip-Connections
        self.up2 = nn.ConvTranspose2d(128, 64, kernel_size=2, stride=2) # Output: 64 x 60
        self.dec2 = nn.Sequential(
            nn.Conv2d(128, 64, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.Conv2d(64, 64, kernel_size=3, padding=1),
            nn.ReLU()
        )
        
        self.up1 = nn.ConvTranspose2d(64, 32, kernel_size=2, stride=2) # Output: 128 x 120
        self.dec1 = nn.Sequential(
            nn.Conv2d(64, 32, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.Conv2d(32, 2, kernel_size=3, padding=1)
        )

    def forward(self, x):
        s1 = self.enc1(x)
        p1 = self.pool1(s1)
        
        s2 = self.enc2(p1)
        p2 = self.pool2(s2)
        
        b = self.bottleneck(p2)
        
        u2 = self.up2(b)
        merge2 = torch.cat([u2, s2], dim=1)
        d2 = self.dec2(merge2)
        
        u1 = self.up1(d2)
        merge1 = torch.cat([u1, s1], dim=1)
        final_output = self.dec1(merge1)
        
        return final_output

# -------------------------------------------------------------------------
# 4. ARCHITECTURE PIPELINE VERIFICATION RUN
# -------------------------------------------------------------------------
if __name__ == "__main__":
    print("Initializing architecture validation test...")
    
    dataset = ClimateDataset()
    dataloader = DataLoader(dataset, batch_size=4, shuffle=True)
    
    x_batch, y_batch = next(iter(dataloader))
    print(f"Batch Tensor Input Shape [Batch, Channels, Lat, Lon]: {x_batch.shape}")
    print(f"Batch Tensor Target Shape [Batch, Channels, Lat, Lon]: {y_batch.shape}")
    
    model = ClimateUNet()
    criterion = PhysicsInformedLoss(lambda_physics=0.05)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
    
    optimizer.zero_grad()
    predictions = model(x_batch)
    
    total_loss, mse, penalty = criterion(predictions, y_batch)
    total_loss.backward()
    optimizer.step()
    
    print("\n--- Pipeline Verification Metrics ---")
    print(f"Model Output Shape: {predictions.shape}")
    print(f"Statistical MSE Component: {mse.item():.6f}")
    print(f"Thermodynamic Laplacian Penalty: {penalty.item():.6f}")
    print(f"Combined Loss Function Value: {total_loss.item():.6f}")
    print("Success: Model graph, tensor alignments, and backward passes are valid.")
