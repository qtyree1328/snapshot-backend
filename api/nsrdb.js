module.exports = async function handler(req, res) {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: "lat/lng required" });
    }

    const NSRDB_KEY = process.env.NSRDB_KEY;
    if (!NSRDB_KEY) {
      return res.status(500).json({ error: "Missing NSRDB_KEY env var" });
    }

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();

    // Use the v1 API endpoint that actually works with your key
    const url = `https://developer.nrel.gov/api/solar/solar_resource/v1.json?api_key=${NSRDB_KEY}&lat=${lat}&lon=${lng}`;

    const resp = await fetch(url);
    if (!resp.ok) {
      const errorText = await resp.text();
      return res.status(resp.status).json({ 
        error: "NREL API request failed", 
        status: resp.status,
        detail: errorText.slice(0, 200)
      });
    }

    const data = await resp.json();
    
    if (!data.outputs) {
      return res.status(404).json({ error: "No solar data available for this location" });
    }

    // Return the solar resource data
    return res.status(200).json({
      location: {
        lat: parseFloat(lat),
        lng: parseFloat(lng)
      },
      solar: {
        avgGhi: data.outputs.avg_ghi?.annual || null,
        avgDni: data.outputs.avg_dni?.annual || null,
        avgTilt: data.outputs.avg_lat_tilt?.annual || null,
        monthly: {
          ghi: data.outputs.avg_ghi?.monthly || null,
          dni: data.outputs.avg_dni?.monthly || null
        }
      },
      source: "NREL Solar Resource API v1"
    });

  } catch (e) {
    return res.status(500).json({ 
      error: "Server error", 
      detail: String(e?.message || e) 
    });
  }
}