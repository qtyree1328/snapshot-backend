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

    // Step 1: Query which datasets are available for this location
    const queryUrl = `https://developer.nrel.gov/api/solar/nsrdb_data_query.json?api_key=${NSRDB_KEY}&wkt=POINT(${lng} ${lat})`;
    
    const queryResp = await fetch(queryUrl);
    if (!queryResp.ok) {
      return res.status(queryResp.status).json({ 
        error: "Failed to query available datasets",
        status: queryResp.status
      });
    }

    const queryData = await queryResp.json();
    
    if (!queryData.outputs || queryData.outputs.length === 0) {
      return res.status(404).json({ 
        error: "No NSRDB data available for this location" 
      });
    }

    // Find the most recent dataset with the most recent year
    let bestDataset = null;
    let mostRecentYear = 0;

    for (const dataset of queryData.outputs) {
      if (!dataset.availableYears || dataset.availableYears.length === 0) continue;
      
      // Filter out "tmy" and get numeric years only
      const numericYears = dataset.availableYears
        .filter(y => typeof y === 'number')
        .sort((a, b) => b - a);
      
      if (numericYears.length > 0 && numericYears[0] > mostRecentYear) {
        mostRecentYear = numericYears[0];
        bestDataset = dataset;
      }
    }

    if (!bestDataset || !mostRecentYear) {
      return res.status(404).json({ 
        error: "No recent year data available" 
      });
    }

    // Step 2: Get the download link for the most recent year
    const yearLink = bestDataset.links?.find(
      link => link.year === mostRecentYear && link.interval === 60
    );

    if (!yearLink) {
      return res.status(404).json({ 
        error: "No download link available for recent data" 
      });
    }

    // Step 3: Fetch the CSV data for that year
    // Replace placeholder values in the link
    let downloadUrl = yearLink.link
      .replace('yourapikey', NSRDB_KEY)
      .replace('youremail', 'snapshot@example.com');

    const dataResp = await fetch(downloadUrl);
    if (!dataResp.ok) {
      return res.status(dataResp.status).json({ 
        error: "Failed to download solar data",
        status: dataResp.status,
        dataset: bestDataset.displayName
      });
    }

    const csvText = await dataResp.text();
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
        year: mostRecentYear,
        annualGhi: ghiAnnualKwh,
        annualDni: dniAnnualKwh,
        avgGhiDaily: ghiAnnualKwh / 365,
        avgDniDaily: dniAnnualKwh / 365,
        hoursRecorded: count
      },
      dataset: {
        name: bestDataset.displayName,
        type: bestDataset.type,
        resolution: bestDataset.resolution || 'N/A'
      },
      source: `NSRDB ${bestDataset.displayName} (${mostRecentYear})`
    });

  } catch (e) {
    return res.status(500).json({ 
      error: "Server error", 
      detail: String(e?.message || e) 
    });
  }
}