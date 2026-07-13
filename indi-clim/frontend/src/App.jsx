import React, { useState, useEffect } from 'react';
import DeckGL from '@deck.gl/react';
import { _GlobeView as GlobeView, MapView, LinearInterpolator } from '@deck.gl/core';
import { ColumnLayer, BitmapLayer, IconLayer, PathLayer } from '@deck.gl/layers';
import { TileLayer } from '@deck.gl/geo-layers';

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

export default function App() {
  // 1. Theme & Perspective States
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [viewScope, setViewScope] = useState('local'); 
  
  // 2. Data Source & Simulation Model Parameters
  const [dataSource, setDataSource] = useState('geo_ai'); 
  const [scenario, setScenario] = useState('el_nino_stress');
  const [intensity, setIntensity] = useState(1.0); 
  const [activeLayer, setActiveLayer] = useState('crop_stress'); 
  
  // 3. Pipeline Status & Analytics
  const [loading, setLoading] = useState(false);
  const [logMessage, setLogMessage] = useState('System synchronized. Awaiting live data streams...');
  const [metrics, setMetrics] = useState({ avg_predicted_temp: 24.15, rainfall_deficit: -10.0, crop_risk_index: 0.85 });
  const [localGrid, setLocalGrid] = useState([]);

  // 4. Hyper-local Telemetry (OpenWeatherMap)
  const [selectedLocationData, setSelectedLocationData] = useState(null);
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  
  // 5. OpenStreetMap Search & Landmark States
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [pinnedLandmarks, setPinnedLandmarks] = useState([]);
  
  // 6. OpenStreetMap (OSRM) Navigation States
  const [routeOrigin, setRouteOrigin] = useState(null); 
  const [activeRoutePath, setActiveRoutePath] = useState([]);
  const [navigationMetrics, setNavigationMetrics] = useState(null);

  // 7. Camera Spatial Matrix
  const [viewState, setViewState] = useState({
    longitude: 78.9629, latitude: 20.5937, zoom: 3.8, pitch: 32, bearing: 0, maxZoom: 14, minZoom: 1.1
  });

  // Handle Smooth View Camera Transitions
  useEffect(() => {
    if (viewScope === 'local') {
      setViewState(prev => ({
        ...prev, longitude: 78.9629, latitude: 22.5937, zoom: 3.8, pitch: 32,
        transitionDuration: 1500, transitionInterpolator: new LinearInterpolator(['longitude', 'latitude', 'zoom', 'pitch'])
      }));
    } else {
      setViewState(prev => ({
        ...prev, longitude: 78.9629, latitude: 20.5937, zoom: 1.1, pitch: 0,
        transitionDuration: 1500, transitionInterpolator: new LinearInterpolator(['longitude', 'latitude', 'zoom', 'pitch'])
      }));
    }
    triggerPipelineExecution();
  }, [viewScope, dataSource]);

  // Execute Backend GeoAI / IMD Simulation
  const triggerPipelineExecution = async () => {
    setLoading(true);
    try {
      const targetEndpoint = dataSource === 'imd_grid' 
        ? `${API_BASE_URL}/api/simulate?scenario=baseline&intensity=1.0` 
        : `${API_BASE_URL}/api/simulate?scenario=${scenario}&intensity=${intensity}`;

      const res = await fetch(targetEndpoint, { method: 'POST' });
      const result = await res.json();
      
      if (result?.status === 'simulation_success') {
        setMetrics(result.metrics);
        setLogMessage(dataSource === 'imd_grid' ? "IMD Gridded Climate Repository deployed." : result.log);
        
        const coordRes = await fetch(`${API_BASE_URL}/api/coordinates/local`);
        const coords = await coordRes.json();
        
        if (coords?.latitudes && result.data_cube) {
          const lats = coords.latitudes, lons = coords.longitudes;
          const { temperature: tMat, precipitation: pMat, crop_stress: cMat } = result.data_cube;
          const flattenedLocal = [];
          
          for (let i = 0; i < lats.length; i++) {
            for (let j = 0; j < lons.length; j++) {
              if (tMat[i]) {
                const temp = tMat[i][j], precip = pMat[i] ? pMat[i][j] : 0;
                flattenedLocal.push({
                  position: [lons[j], lats[i]], temp, precip,
                  cropStress: cMat[i] ? cMat[i][j] : 0,
                  waterDepletion: Math.max(0, 50 - precip)
                });
              }
            }
          }
          setLocalGrid(flattenedLocal);
        }
      }
    } catch (e) {
      setLogMessage("API pipeline offline. Rendering local interface cache.");
    } finally {
      setLoading(false);
    }
  };

  // Execute OpenStreetMap Geocoding Search
  const handleSearchInputChange = async (val) => {
    setSearchQuery(val);
    if (val.length < 3) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/api/search?query=${encodeURIComponent(val)}`);
      const data = await res.json();
      if (data.results) setSearchResults(data.results);
    } catch (e) {
      console.error(e);
    }
  };

  // Select Search Result, Drop Pin, and Move Camera
  const selectLandmark = (landmark) => {
    const [lng, lat] = landmark.coordinates;
    setSearchQuery('');
    setSearchResults([]);
    
    setPinnedLandmarks([{ position: [lng, lat], name: landmark.name }]);
    
    setViewState(prev => ({
      ...prev, longitude: lng, latitude: lat, zoom: 8.5, pitch: 45,
      transitionDuration: 2000, transitionInterpolator: new LinearInterpolator(['longitude', 'latitude', 'zoom', 'pitch'])
    }));
    
    fetchLocationTelemetry(lat, lng);
  };

  // Generate OSRM Free Navigation Route
  const generateRoute = async (endLng, endLat) => {
    if (!routeOrigin) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/route?start_lng=${routeOrigin[0]}&start_lat=${routeOrigin[1]}&end_lng=${endLng}&end_lat=${endLat}`);
      const data = await res.json();
      if (data.path) {
        setActiveRoutePath(data.path);
        setNavigationMetrics({ distance: data.distance_km, duration: data.duration_mins });
        setLogMessage(`Navigation engine locked. Total Route: ${data.distance_km} km.`);
      } else {
        setLogMessage("Route execution failed: No legal road vectors between coordinates.");
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Fetch OpenWeatherMap Coordinates Metrics
  const fetchLocationTelemetry = async (lat, lon) => {
    setTelemetryLoading(true);
    setSelectedLocationData(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/telemetry?lat=${lat}&lon=${lon}`);
      const data = await res.json();
      if (!data.error) setSelectedLocationData(data);
    } catch (e) {
      console.error(e);
    } finally {
      setTelemetryLoading(false);
    }
  };

  // Color Mapping Engine for 3D Columns
  const getColor = (d) => {
    if (!d) return [0, 0, 0, 0];
    if (activeLayer === 'crop_stress') {
      const v = Math.max(0, Math.min(1, d.cropStress / 65));
      return [v * 255, 220 - (v * 180), 45, 170]; 
    } else if (activeLayer === 'water_depletion') {
      const v = Math.max(0, Math.min(1, d.waterDepletion / 50));
      return [140 * v, 80 * v, 255 - (v * 180), 170];
    } else if (activeLayer === 'temperature') {
      const v = Math.max(0, Math.min(1, (d.temp - 12) / 26));
      return [v * 255, 50 + (1 - v) * 40, (1 - v) * 255, 150]; 
    }
    return [0, 150, 255, 150];
  };

  // Master Deck.GL Layers Array
  const layers = [
    new TileLayer({
      id: 'satellite-basemap',
      data: isDarkMode 
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{y}/{x}.png',
      minZoom: 0, maxZoom: 14, tileSize: 256,
      renderSubLayers: props => {
        const { bbox } = props.tile;
        if (!bbox) return null;
        return new BitmapLayer(props, { data: null, image: props.data, bounds: [bbox.west, bbox.south, bbox.east, bbox.north] });
      }
    }),
    new ColumnLayer({
      id: 'spatial-climate-mesh',
      data: localGrid,
      pickable: true, radius: viewScope === 'local' ? 16000 : 85000, diskResolution: 20, extruded: true, 
      elevationScale: viewScope === 'local' ? 5000 : 25000,
      getPosition: d => d.position, getFillColor: d => getColor(d),
      getElevation: d => activeLayer === 'crop_stress' ? d.cropStress : activeLayer === 'water_depletion' ? d.waterDepletion : Math.max(0, d.temp),
      updateTriggers: { getFillColor: [activeLayer, localGrid], getElevation: [activeLayer, localGrid] }
    }),
    new IconLayer({
      id: 'landmark-pins',
      data: pinnedLandmarks,
      pickable: true,
      getIcon: d => ({
        url: 'https://cdn-icons-png.flaticon.com/512/684/684908.png',
        width: 128, height: 128, anchorY: 128
      }),
      sizeScale: 15,
      getSize: d => 3, getPosition: d => d.position
    }),
    new PathLayer({
      id: 'navigation-route-line',
      data: activeRoutePath.length > 0 ? [{ path: activeRoutePath }] : [],
      getPath: d => d.path,
      getColor: [0, 195, 255, 255],
      getWidth: 8, widthMinPixels: 4,
      shadowEnabled: true
    })
  ];

  return (
    <div className={`w-screen h-screen flex flex-col font-sans overflow-hidden transition-colors duration-500 antialiased ${isDarkMode ? 'bg-[#05070a] text-zinc-100' : 'bg-[#f3f6f5] text-zinc-900'}`}>
      
      {/* --- Top Header Navigation --- */}
      <nav className={`w-full h-14 border-b backdrop-blur-2xl z-30 flex items-center justify-between px-8 text-xs font-medium tracking-wide ${isDarkMode ? 'bg-[#090b10]/70 border-zinc-800/40' : 'bg-white/70 border-zinc-200/60'}`}>
        <div className="flex items-center gap-3">
          <div className="font-bold text-[14px] tracking-tight uppercase">Indi-Clim <span className="font-light text-sky-500">Twin</span></div>
        </div>
        
        {routeOrigin && (
          <div className="bg-sky-500/10 border border-sky-500/30 text-sky-400 px-4 py-1 rounded-full text-[10px] uppercase font-mono tracking-wider animate-pulse">
            Navigation Active Route Node Set. Click next target point to trace path.
          </div>
        )}

        <div className="flex items-center gap-4">
          <div className="flex bg-black/10 rounded-full p-0.5 border border-white/5">
            <button onClick={() => setViewScope('local')} className={`px-4 py-1 rounded-full transition-all text-[11px] ${viewScope === 'local' ? 'bg-sky-500 text-white shadow-sm' : 'text-zinc-400'}`}>2D Map (India)</button>
            <button onClick={() => setViewScope('global')} className={`px-4 py-1 rounded-full transition-all text-[11px] ${viewScope === 'global' ? 'bg-sky-500 text-white shadow-sm' : 'text-zinc-400'}`}>3D Globe (Macro)</button>
          </div>
          <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-2 border rounded-full text-[11px] font-bold">
            {isDarkMode ? '☀️ Light' : '🌙 Dark'}
          </button>
        </div>
      </nav>

      <div className="flex-1 w-full relative flex overflow-hidden">
        
        {/* --- Left Column Interface: Search & Tools --- */}
        <div className="absolute top-6 left-6 z-20 w-[360px] flex flex-col gap-4 max-h-[85vh] overflow-y-auto pr-1">
          
          {/* Landmark & Coordinate Search */}
          <div className={`rounded-3xl border backdrop-blur-3xl p-5 shadow-2xl relative ${isDarkMode ? 'bg-[#090b10]/85 border-white/5' : 'bg-white/85 border-black/5'}`}>
            <label className="text-[10px] uppercase font-bold tracking-wider text-zinc-400">OSM Geocoding Engine</label>
            <div className="relative mt-2">
              <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => handleSearchInputChange(e.target.value)}
                placeholder="Search Gateway of India, Mumbai..." 
                className={`w-full p-3 rounded-xl border text-xs outline-none bg-transparent ${isDarkMode ? 'border-zinc-800 focus:border-sky-500 text-white' : 'border-zinc-300 focus:border-sky-500 text-black'}`}
              />
              
              {searchResults.length > 0 && (
                <div className={`absolute left-0 right-0 mt-2 rounded-xl border shadow-xl z-50 overflow-hidden ${isDarkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-zinc-200'}`}>
                  {searchResults.map((result, idx) => (
                    <button 
                      key={idx} 
                      onClick={() => selectLandmark(result)}
                      className={`w-full text-left p-3 text-xs border-b last:border-0 transition-colors ${isDarkMode ? 'border-zinc-900 hover:bg-zinc-900 text-zinc-300' : 'border-zinc-100 hover:bg-zinc-50 text-zinc-700'}`}
                    >
                      {result.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            <div className="flex gap-2 mt-3">
              <button 
                onClick={() => {
                  if (pinnedLandmarks.length > 0) {
                    setRouteOrigin(pinnedLandmarks[0].position);
                    setLogMessage("Starting navigation node locked to pinned landmark.");
                  } else {
                    setLogMessage("Error: Pin or click a landmark target to establish origin point first.");
                  }
                }}
                className="flex-1 py-2 rounded-lg text-[10px] font-mono border uppercase tracking-wider bg-transparent text-center border-sky-500 text-sky-400 hover:bg-sky-500/10"
              >
                Set Pin As Route Start
              </button>
              {routeOrigin && (
                <button 
                  onClick={() => {
                    setRouteOrigin(null);
                    setActiveRoutePath([]);
                    setNavigationMetrics(null);
                  }}
                  className="px-3 py-2 rounded-lg text-[10px] font-mono border uppercase tracking-wider text-red-400 border-red-500/30 hover:bg-red-500/10"
                >
                  Clear Route
                </button>
              )}
            </div>
          </div>

          {/* Core Simulation Control Center */}
          <div className={`rounded-3xl border backdrop-blur-3xl p-5 shadow-2xl flex flex-col gap-4 ${isDarkMode ? 'bg-[#090b10]/85 border-white/5' : 'bg-white/85 border-black/5'}`}>
            <div className={`grid grid-cols-2 p-1 rounded-xl border ${isDarkMode ? 'bg-zinc-950/60 border-zinc-800/50' : 'bg-zinc-100 border-zinc-200'}`}>
              <button onClick={() => setDataSource('geo_ai')} className={`py-2 text-[11px] font-semibold rounded-lg transition-all ${dataSource === 'geo_ai' ? 'bg-sky-500 text-white' : 'text-zinc-500'}`}>GeoAI Models</button>
              <button onClick={() => setDataSource('imd_grid')} className={`py-2 text-[11px] font-semibold rounded-lg transition-all ${dataSource === 'imd_grid' ? 'bg-sky-500 text-white' : 'text-zinc-500'}`}>Official IMD Grid</button>
            </div>

            {dataSource === 'geo_ai' ? (
              <div className="flex flex-col gap-3">
                <select value={scenario} onChange={(e) => setScenario(e.target.value)} className={`w-full p-2.5 rounded-xl border text-xs outline-none bg-transparent ${isDarkMode ? 'border-zinc-800' : 'border-zinc-300'}`}>
                  <option value="el_nino_stress">El Niño Monsoon Forcing</option>
                  <option value="urbanization">Thermal Urbanization Core</option>
                </select>
                <input type="range" min="0.2" max="3.0" step="0.1" value={intensity} onChange={(e) => setIntensity(parseFloat(e.target.value))} className="w-full accent-sky-500" />
              </div>
            ) : (
              <div className="p-2.5 rounded-xl border bg-emerald-500/5 border-emerald-500/20 text-emerald-500 text-[10px] leading-relaxed">
                <strong>IMD Grid Active:</strong> Utilizing your secure server-side government APIs for real-world arrays.
              </div>
            )}

            <div className="grid grid-cols-3 gap-1 mt-1">
              {['crop_stress', 'water_depletion', 'temperature'].map((layer) => (
                <button key={layer} onClick={() => setActiveLayer(layer)} className={`py-1.5 text-[9px] font-bold rounded-md border uppercase ${activeLayer === layer ? 'bg-sky-500/10 border-sky-500 text-sky-500' : 'border-zinc-800'}`}>
                  {layer.replace('_', ' ')}
                </button>
              ))}
            </div>

            <button onClick={triggerPipelineExecution} disabled={loading} className="w-full py-2.5 font-semibold rounded-xl text-xs bg-sky-500 text-white shadow-lg">
              {loading ? 'Recomputing Metrics...' : 'Run Analysis Execution'}
            </button>
          </div>
        </div>

        {/* --- Bottom Left: System Log & Output Metrics --- */}
        <div className={`absolute bottom-6 left-6 z-20 w-[360px] p-4 rounded-2xl border text-[11px] font-mono backdrop-blur-md ${isDarkMode ? 'bg-black/40 border-zinc-800/60 text-zinc-400' : 'bg-white/50 border-zinc-200 text-zinc-600'}`}>
          <p className="mb-2"><strong>System Log:</strong> {logMessage}</p>
          
          {navigationMetrics && (
            <div className="mb-2 p-2 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
              ✈️ <strong>OSRM Route:</strong> {navigationMetrics.distance} km | Approx. {navigationMetrics.duration} mins.
            </div>
          )}

          <div className="grid grid-cols-3 border-t border-zinc-800/40 pt-2 text-center text-[10px]">
            <div><span className="text-zinc-500 block">AVG TEMP</span><strong>{metrics.avg_predicted_temp.toFixed(1)}°C</strong></div>
            <div><span className="text-zinc-500 block">RAIN DEFICIT</span><strong>{metrics.rainfall_deficit.toFixed(0)}%</strong></div>
            <div><span className="text-zinc-500 block">RISK FACTOR</span><strong>{metrics.crop_risk_index.toFixed(2)}</strong></div>
          </div>
        </div>

        {/* --- Bottom Right: Live Localized Telemetry Panel --- */}
        {(selectedLocationData || telemetryLoading) && (
          <div className={`absolute bottom-6 right-6 z-30 w-[380px] rounded-3xl border backdrop-blur-2xl p-5 shadow-2xl ${isDarkMode ? 'bg-[#090b10]/85 border-white/10 text-white' : 'bg-white/85 border-black/10 text-zinc-900'}`}>
            {telemetryLoading ? (
              <div className="flex items-center justify-center py-8 text-xs font-semibold text-sky-500 animate-pulse">Syncing Micro-Telemetry...</div>
            ) : selectedLocationData?.location ? (
              <div className="flex flex-col gap-3 text-xs">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-black tracking-tight">{selectedLocationData.location.name}</h3>
                    <p className="text-[10px] text-zinc-400 uppercase tracking-wider">{selectedLocationData.location.region}, {selectedLocationData.location.country}</p>
                  </div>
                  <button onClick={() => setSelectedLocationData(null)} className="text-zinc-500 text-sm font-bold">&times;</button>
                </div>

                <div className="flex items-center gap-2 p-2 rounded-xl bg-white/5 border border-white/5">
                  <img src={selectedLocationData.current.condition.icon} alt="Weather Status" className="w-8 h-8" />
                  <span className="font-bold">{selectedLocationData.current.condition.text}</span>
                </div>
                
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 rounded-lg bg-white/5"><span className="text-[9px] text-zinc-500 block">TEMP</span><strong>{selectedLocationData.current.temp_c}°C</strong></div>
                  <div className="p-2 rounded-lg bg-white/5"><span className="text-[9px] text-zinc-500 block">WIND</span><strong>{selectedLocationData.current.wind_kph} kph</strong></div>
                  <div className="p-2 rounded-lg bg-white/5"><span className="text-[9px] text-zinc-500 block">AQI</span><strong>Index {selectedLocationData.current.air_quality?.['us-epa-index'] || '1'}</strong></div>
                  <div className="p-2 rounded-lg bg-white/5"><span className="text-[9px] text-zinc-500 block">PRECIP</span><strong>{selectedLocationData.current.precip_mm} mm</strong></div>
                  <div className="p-2 rounded-lg bg-white/5 col-span-2"><span className="text-[9px] text-zinc-500 block">MOON PHASE</span><strong className="text-sky-400">{selectedLocationData.forecast?.forecastday[0]?.astro?.moon_phase || 'Synodic'}</strong></div>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* --- The Master Rendering Engine (Deck.GL Canvas) --- */}
        <div className="w-full h-full relative z-10 outline-none">
          <DeckGL
            views={viewScope === 'global' ? new GlobeView({ controller: true }) : new MapView({ controller: true })}
            viewState={viewState}
            onViewStateChange={e => setViewState(e.viewState)}
            layers={layers}
            onClick={(info) => {
              if (info.coordinate) {
                const [longitude, latitude] = info.coordinate;
                fetchLocationTelemetry(latitude, longitude);
                
                // Triggers OpenStreetMap routing if a starting point is set
                if (routeOrigin) {
                  generateRoute(longitude, latitude);
                }
              }
            }}
            getCursor={({isHovering}) => isHovering ? 'pointer' : 'crosshair'}
          />
        </div>
      </div>
    </div>
  );
}
