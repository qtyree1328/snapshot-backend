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

    // Try to get recent data from NSRDB GOES Aggregated (1998-present)
    // This is the most reliable endpoint for recent US data
    const year = 2023; // Most recent full year likely to be available
    
    const params = new URLSearchParams({
      api_key: NSRDB_KEY,
      wkt: `POINT(${lng} ${lat})`,
      names: year.toString(),
      attributes: 'ghi,dni',
      interval: '60',
      utc: 'false',
      leap_day: 'false',
      email: 'snapshot@example.com',
      full_name: 'Snapshot Analysis',
      affiliation: 'Internal Tool',
      reason: 'Solar feasibility analysis'
    });

    // Use GOES Aggregated v4 endpoint (most recent dataset with broad coverage)
    const url = `https://developer.nrel.gov/api/nsrdb/v2/solar/nsrdb-GOES-aggregated-v4-0-0-download.csv?${params}`;

    const resp = await fetch(url);
    
    if (!resp.ok) {
      const errorText = await resp.text();
      
      // If 2023 fails, try 2022
      if (resp.status === 400 || resp.status === 404) {
        const params2022 = new URLSearchParams({
          api_key: NSRDB_KEY,
          wkt: `POINT(${lng} ${lat})`,
          names: '2022',
          attributes: 'ghi,dni',
          interval: '60',
          utc: 'false',
          leap_day: 'false',
          email: 'snapshot@example.com',
          full_name: 'Snapshot Analysis',
          affiliation: 'Internal Tool',
          reason: 'Solar feasibility analysis'
        });
        
        const url2022 = `https://developer.nrel.gov/api/nsrdb/v2/solar/nsrdb-GOES-aggregated-v4-0-0-download.csv?${params2022}`;
        const resp2022 = await fetch(url2022);
        
        if (!resp2022.ok) {
          return res.status(resp2022.status).json({ 
            error: "NSRDB data not available for 2023 or 2022",
            status: resp2022.status,
            detail: errorText.slice(0, 200)
          });
        }
        
        return processResponse(resp2022, lat, lng, 2022, res);
      }
      
      return res.status(resp.status).json({ 
        error: "NSRDB API request failed", 
        status: resp.status,
        detail: errorText.slice(0, 200)
      });
    }

    return processResponse(resp, lat, lng, year, res);

  } catch (e) {
    return res.status(500).json({ 
      error: "Server error", 
      detail: String(e?.message || e) 
    });
  }
}

async function processResponse(resp, lat, lng, year, res) {
  const csvText = await resp.text();
  const lines = csvText.trim().split('\n');

  if (lines.length < 10) {
    return res.status(204).json({ 
      error: "Insufficient data in response" 
    });
  }

  // Find the header line (contains GHI)
  let headerIdx = -1;
  for (let i = 0; i < Math.min(15, lines.length); i++) {
    if (lines[i].toUpperCase().includes('GHI')) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    return res.status(500).json({ 
      error: "Could not find data header in CSV" 
    });
  }

  const headers = lines[headerIdx].split(',').map(s => s.trim().toUpperCase());
  const ghiIdx = headers.indexOf('GHI');
  const dniIdx = headers.indexOf('DNI');

  if (ghiIdx === -1) {
    return res.status(500).json({ 
      error: "GHI column not found in data" 
    });
  }

  // Calculate annual totals
  let ghiSum = 0, dniSum = 0, count = 0;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const ghiVal = parseFloat(cols[ghiIdx]);
    const dniVal = dniIdx >= 0 ? parseFloat(cols[dniIdx]) : NaN;
    
    if (!Number.isFinite(ghiVal)) continue;

    ghiSum += ghiVal;
    if (Number.isFinite(dniVal)) dniSum += dniVal;
    count++;
  }

  if (!count) {
    return res.status(204).json({ 
      error: "No valid data records found" 
    });
  }

  const ghiAnnualKwh = ghiSum / 1000; // Wh/m² -> kWh/m²
  const dniAnnualKwh = dniSum / 1000;

  return res.status(200).json({
    location: {
      lat: parseFloat(lat),
      lng: parseFloat(lng)
    },
    solar: {
      year: year,
      annualGhi: ghiAnnualKwh,
      annualDni: dniAnnualKwh,
      avgGhiDaily: ghiAnnualKwh / 365,
      avgDniDaily: dniAnnualKwh / 365,
      hoursRecorded: count
    },
    source: `NSRDB GOES Aggregated v4 (${year})`
  });
}