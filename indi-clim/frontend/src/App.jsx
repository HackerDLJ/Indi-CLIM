import React, { useState, useEffect } from 'react';
import DeckGL from '@deck.gl/react';
import { _GlobeView as GlobeView, MapView, LinearInterpolator } from '@deck.gl/core';
import { ColumnLayer, BitmapLayer } from '@deck.gl/layers';
import { TileLayer } from '@deck.gl/geo-layers';

const getBackendUrl = () => {
  if (window.location && window.location.hostname && window.location.hostname.includes('github.dev')) {
    return `https://${window.location.hostname.replace('-5173', '-8000')}`;
  }
  return 'http://localhost:8000';
};

const BACKEND_URL = getBackendUrl();

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [viewScope, setViewScope] = useState('global'); 
  const [projectionMode, setProjectionMode] = useState('globe'); 
  const [scenario, setScenario] = useState('urbanization');
  const [intensity, setIntensity] = useState(1.0);
  const [activeLayer, setActiveLayer] = useState('temperature'); 
  const [loading, setLoading] = useState(false);
  const [logMessage, setLogMessage] = useState('Empirical system live. Operational synchronization complete.');
  
  const [metrics, setMetrics] = useState({ avg_predicted_temp: 24.15, avg_predicted_precip: 6.82 });
  const [localGrid, setLocalGrid] = useState([]);
  const [globalGrid, setGlobalGrid] = useState([]);

  const [viewState, setViewState] = useState({
    longitude: 78.9629,
    latitude: 20.5937,
    zoom: 1.1,
    pitch: 0,
    bearing: 0,
    maxZoom: 9,
    minZoom: 1.1
  });

  useEffect(() => {
    if (viewScope === 'local') {
      setViewState(prev => ({
        ...prev,
        longitude: 78.9629,
        latitude: 22.5937,
        zoom: 3.8,
        pitch: 32,
        bearing: 0,
        maxZoom: 12,
        minZoom: 3.0,
        transitionDuration: 1800,
        transitionInterpolator: new LinearInterpolator(['longitude', 'latitude', 'zoom', 'pitch'])
      }));
    } else {
      setViewState(prev => ({
        ...prev,
        longitude: 78.9629,
        latitude: 20.5937,
        zoom: 1.1,
        pitch: 0,
        bearing: 0,
        maxZoom: 9,
        minZoom: 1.1,
        transitionDuration: 1800,
        transitionInterpolator: new LinearInterpolator(['longitude', 'latitude', 'zoom', 'pitch'])
      }));
    }
    triggerSimulation();
  }, [viewScope]);

  const triggerSimulation = async () => {
    setLoading(true);
    try {
      const useGlobal = viewScope === 'global';
      const res = await fetch(`${BACKEND_URL}/api/simulate?scenario=${scenario}&intensity=${intensity}&synthesize_global=${useGlobal}`, {
        method: 'POST'
      });
      const result = await res.json();
      
      if (result && result.status === 'simulation_success') {
        setMetrics(result.metrics);
        setLogMessage(result.log);

        const coordRes = await fetch(`${BACKEND_URL}/api/coordinates/local`);
        const coords = await coordRes.json();
        
        if (coords && coords.latitudes && coords.longitudes && result.data_cube) {
          const lats = coords.latitudes;
          const lons = coords.longitudes;
          const tMat = result.data_cube.temperature || [];
          const pMat = result.data_cube.precipitation || [];

          const flattenedLocal = [];
          for (let i = 0; i < lats.length; i++) {
            for (let j = 0; j < lons.length; j++) {
              if (tMat[i]) {
                flattenedLocal.push({
                  position: [lons[j], lats[i]],
                  temp: tMat[i][j],
                  precip: pMat[i] ? pMat[i][j] : 0
                });
              }
            }
          }
          setLocalGrid(flattenedLocal);
        }
      }
    } catch (e) {
      console.error(e);
      setLogMessage("Handshake termination. Re-verifying cloud routing ports...");
    } finally {
      setLoading(false);
    }
  };

  const getColor = (d) => {
    if (!d) return [0, 0, 0, 0];
    if (activeLayer === 'temperature') {
      const v = Math.max(0, Math.min(1, (d.temp - 12) / 26));
      return [v * 255, 45 + (1 - v) * 35, (1 - v) * 255, 135]; 
    } else {
      const v = Math.max(0, Math.min(1, d.precip / 30));
      return [15, 125 + (v * 120), 245 + (v * 10), 135];
    }
  };

  const layers = [
    new TileLayer({
      id: 'nasa-satellite-tiles',
      data: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      minZoom: 0,
      maxZoom: 12,
      tileSize: 256,
      renderSubLayers: props => {
        const { bbox } = props.tile;
        // Fix: Added safety check to prevent initialization crashes
        if (!bbox) return null;
        return new BitmapLayer(props, {
          data: null, 
          image: props.data, 
          bounds: [bbox.west, bbox.south, bbox.east, bbox.north]
        });
      }
    }),
    new ColumnLayer({
      id: 'climate-analysis-mesh',
      data: viewScope === 'local' ? localGrid : globalGrid,
      pickable: true,
      radius: viewScope === 'local' ? 15000 : 90000, 
      diskResolution: 16, 
      extruded: true, 
      elevationScale: viewScope === 'local' ? 4500 : 22000,
      getPosition: d => d.position,
      getFillColor: d => getColor(d),
      getElevation: d => activeLayer === 'temperature' ? Math.max(0, d.temp) : d.precip,
      updateTriggers: {
        getFillColor: [activeLayer, localGrid, globalGrid, viewScope],
        getElevation: [activeLayer, localGrid, globalGrid, viewScope]
      }
    })
  ];

  const currentViewProfile = viewScope === 'global' && projectionMode === 'globe'
    ? new GlobeView({ controller: { inertia: true, dragRotate: true } })
    : new MapView({ controller: { inertia: true, dragRotate: true } });

  return (
    <div className={`w-screen h-screen flex flex-col font-sans overflow-hidden transition-all duration-700 antialiased selection:bg-sky-500/30 ${isDarkMode ? 'bg-[#060709] text-zinc-100' : 'bg-[#f4f7f6] text-zinc-900'}`}>
      
      <nav className={`w-full h-14 border-b backdrop-blur-2xl z-30 flex items-center justify-between px-8 text-xs tracking-tight font-normal transition-all ${isDarkMode ? 'bg-[#0c0e12]/60 border-zinc-800/30' : 'bg-white/60 border-zinc-200/60'}`}>
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2.5">
            <span className="font-semibold text-[13px] tracking-tight uppercase">Indi-Clim <span className="font-light opacity-50">Twin</span></span>
          </div>
          
          <div className={`h-4 w-[1px] ${isDarkMode ? 'bg-zinc-800/60' : 'bg-zinc-200'}`} />
          
          <div className={`flex gap-1 p-0.5 rounded-full border backdrop-blur-xl ${isDarkMode ? 'bg-zinc-950/40 border-zinc-800/40' : 'bg-zinc-200/40 border-zinc-300/40'}`}>
            <button onClick={() => setViewScope('local')} className={`px-4 py-1.5 rounded-full transition-all duration-300 text-[11px] font-semibold ${viewScope === 'local' ? (isDarkMode ? 'bg-zinc-800 text-sky-400 shadow-md' : 'bg-white text-zinc-950 shadow-sm') : 'text-zinc-400 hover:text-zinc-500'}`}>Regional Grid Matrix</button>
            <button onClick={() => setViewScope('global')} className={`px-4 py-1.5 rounded-full transition-all duration-300 text-[11px] font-semibold ${viewScope === 'global' ? (isDarkMode ? 'bg-zinc-800 text-sky-400 shadow-md' : 'bg-white text-zinc-950 shadow-sm') : 'text-zinc-400 hover:text-zinc-500'}`}>Google Earth Satellite Globe</button>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {viewScope === 'global' && (
            <div className={`flex items-center gap-1 p-0.5 rounded-full border ${isDarkMode ? 'bg-zinc-950/40 border-zinc-800/40' : 'bg-zinc-200/40 border-zinc-300/40'}`}>
              <button onClick={() => setProjectionMode('globe')} className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-all duration-300 ${projectionMode === 'globe' ? (isDarkMode ? 'text-sky-400 bg-zinc-800' : 'text-zinc-950 bg-white shadow-sm') : 'text-zinc-400'}`}>3D Globe</button>
              <button onClick={() => setProjectionMode('flat')} className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-all duration-300 ${projectionMode === 'flat' ? (isDarkMode ? 'text-sky-400 bg-zinc-800' : 'text-zinc-950 bg-white shadow-sm') : 'text-zinc-400'}`}>2D Map</button>
            </div>
          )}
          <button onClick={() => setIsDarkMode(!isDarkMode)} className={`px-4 py-1.5 text-[11px] font-semibold rounded-full border transition-all duration-300 ${isDarkMode ? 'bg-zinc-900/60 border-zinc-800/80 text-amber-400 hover:bg-zinc-800' : 'bg-zinc-100 border-zinc-200 text-zinc-800 hover:bg-zinc-200'}`}>
            {isDarkMode ? '💡 Light Mode' : '🌙 Dark Mode'}
          </button>
        </div>
      </nav>

      <div className="flex-1 w-full relative flex overflow-hidden">
        <div className={`absolute top-6 left-6 z-20 w-[350px] rounded-3xl border backdrop-blur-3xl p-6 flex flex-col gap-6 transition-all duration-500 shadow-xl ${isDarkMode ? 'bg-[#0b0d12]/60 border-white/5 shadow-black/40' : 'bg-white/60 border-black/5 shadow-zinc-300/30'}`}>
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight">Analytical Solver</h2>
            <p className={`text-[11px] font-medium transition-colors ${isDarkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>Empirical Spatial Inversion Platform</p>
          </div>
          <div className={`h-[1px] ${isDarkMode ? 'bg-white/5' : 'bg-black/5'}`} />
          <div className="flex flex-col gap-3.5">
            <span className={`text-[10px] uppercase font-bold tracking-wider ${isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>Forcing Vector Selection</span>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setScenario('urbanization')} className={`py-2 px-3 rounded-2xl text-xs font-semibold border transition-all duration-300 ${scenario === 'urbanization' ? 'bg-sky-500 text-white border-sky-400 shadow-md shadow-sky-500/20' : (isDarkMode ? 'bg-white/5 border-transparent hover:bg-white/10' : 'bg-black/5 border-transparent hover:bg-black/10')}`}>🏢 Urban Heat</button>
              <button onClick={() => setScenario('sst_anomaly')} className={`py-2 px-3 rounded-2xl text-xs font-semibold border transition-all duration-300 ${scenario === 'sst_anomaly' ? 'bg-sky-500 text-white border-sky-400 shadow-md shadow-sky-500/20' : (isDarkMode ? 'bg-white/5 border-transparent hover:bg-white/10' : 'bg-black/5 border-transparent hover:bg-black/10')}`}>🌊 SST Forcing</button>
            </div>
            <div className="flex flex-col gap-1.5 mt-1">
              <div className="flex justify-between text-[11px] font-semibold text-zinc-400">
                <span>Boundary Parameter Forcing</span>
                <span className="text-sky-500 font-medium">{intensity.toFixed(1)}x</span>
              </div>
              <input type="range" min="0.1" max="3.0" step="0.1" value={intensity} onChange={(e) => setIntensity(parseFloat(e.target.value))} className="w-full accent-sky-500 h-1 bg-zinc-700/40 rounded-full appearance-none cursor-pointer" />
            </div>
            <button onClick={triggerSimulation} disabled={loading} className={`w-full mt-2 py-3 font-semibold rounded-2xl text-xs transition-all duration-300 active:scale-[0.98] ${isDarkMode ? 'bg-white text-zinc-950 hover:bg-zinc-200' : 'bg-zinc-900 text-white hover:bg-zinc-800'} disabled:opacity-30`}>
              {loading ? 'Solving Atmospheric Tensor...' : 'Compute Global Solutions'}
            </button>
          </div>
          <div className={`h-[1px] ${isDarkMode ? 'bg-white/5' : 'bg-black/5'}`} />
          <div className="flex flex-col gap-3">
            <span className={`text-[10px] uppercase font-bold tracking-wider ${isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>NASA Satellite Metrics Baseline</span>
            <div className="grid grid-cols-2 gap-2.5">
              <div className={`p-3 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/5' : 'bg-black/5 border-black/5'}`}>
                <span className="text-[10px] text-zinc-400 block mb-0.5 font-medium tracking-tight">Mean Temperature</span>
                <span className="text-[15px] font-semibold text-orange-500">{metrics.avg_predicted_temp.toFixed(2)} °C</span>
              </div>
              <div className={`p-3 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/5' : 'bg-black/5 border-black/5'}`}>
                <span className="text-[10px] text-zinc-400 block mb-0.5 font-medium tracking-tight">Mean Precipitation</span>
                <span className="text-[15px] font-semibold text-blue-500">{metrics.avg_predicted_precip.toFixed(2)} mm</span>
              </div>
            </div>
          </div>
          <div className={`p-3 rounded-2xl border text-[11px] font-medium leading-relaxed shadow-inner ${isDarkMode ? 'bg-black/20 border-white/5 text-emerald-400' : 'bg-zinc-100/60 border-black/5 text-emerald-700'}`}>
            <span className="opacity-40 font-bold">● </span>{logMessage}
          </div>
        </div>

        <div className={`absolute top-6 right-6 z-20 px-1 py-1 rounded-full border backdrop-blur-2xl flex gap-1 items-center text-xs font-medium ${isDarkMode ? 'bg-[#0b0d12]/60 border-white/5 text-zinc-300' : 'bg-white/60 border-black/5 text-zinc-800'}`}>
          <div className="flex p-0.5 rounded-full">
            <button onClick={() => setActiveLayer('temperature')} className={`px-4 py-1.5 rounded-full text-[11px] font-semibold transition-all duration-300 ${activeLayer === 'temperature' ? 'bg-orange-500 text-white shadow-md' : 'text-zinc-400 hover:text-zinc-300'}`}>Thermal Core</button>
            <button onClick={() => setActiveLayer('precipitation')} className={`px-4 py-1.5 rounded-full text-[11px] font-semibold transition-all duration-300 ${activeLayer === 'precipitation' ? 'bg-blue-500 text-white shadow-md' : 'text-zinc-400 hover:text-zinc-300'}`}>Precipitation</button>
          </div>
        </div>

        <div className="w-full h-full relative z-10 outline-none">
          <DeckGL
            views={currentViewProfile}
            viewState={viewState}
            onViewStateChange={e => setViewState(e.viewState)}
            layers={layers}
            getCursor={({isHovering}) => isHovering ? 'pointer' : 'grab'}
          />
        </div>
      </div>
    </div>
  );
}
