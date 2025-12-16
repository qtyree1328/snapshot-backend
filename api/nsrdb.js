export default async function handler(req, res) {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: "lat/lng required" });
    }

    const NSRDB_KEY = process.env.NSRDB_KEY;
    if (!NSRDB_KEY) {
      return res.status(500).json({ error: "Missing NSRDB_KEY env var" });
    }

    // CORS: allow your frontend to call this endpoint
    // For first test, allow all. After it works, restrict to your domains.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();

    const baseParams = {
      api_key: NSRDB_KEY,
      wkt: `POINT(${lng} ${lat})`,
      attributes: "ghi,dni",
      interval: "60",
      utc: "false",
      leap_day: "false",
      email: "snapshot@example.com",
      full_name: "Snapshot Analysis",
      affiliation: "Internal Tool",
      reason: "Automated solar feasibility study",
      mailing_list: "false"
    };

    const years = [2019, 2020, 2021, 2022, 2023];
    const yearly = [];

    for (const year of years) {
      const params = new URLSearchParams({ ...baseParams, names: String(year) });
      const url = `https://developer.nrel.gov/api/nsrdb/v2/solar/psm3-download.csv?${params}`;

      const resp = await fetch(url);
      if (!resp.ok) continue;

      const csvText = await resp.text();
      const lines = csvText.trim().split("\n");
      if (lines.length < 10) continue;

      // Find the header line (contains GHI)
      let headerIdx = -1;
      for (let i = 0; i < Math.min(15, lines.length); i++) {
        if (lines[i].toUpperCase().includes("GHI")) {
          headerIdx = i;
          break;
        }
      }
      if (headerIdx === -1) continue;

      const headers = lines[headerIdx].split(",").map(s => s.trim().toUpperCase());
      const ghiIdx = headers.indexOf("GHI");
      const dniIdx = headers.indexOf("DNI");
      if (ghiIdx === -1) continue;

      let ghiSum = 0, dniSum = 0, count = 0;

      for (let i = headerIdx + 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        const ghiVal = parseFloat(cols[ghiIdx]);
        const dniVal = dniIdx >= 0 ? parseFloat(cols[dniIdx]) : NaN;
        if (!Number.isFinite(ghiVal)) continue;

        ghiSum += ghiVal;
        if (Number.isFinite(dniVal)) dniSum += dniVal;
        count++;
      }

      if (!count) continue;

      const ghiAnnualKwh = ghiSum / 1000; // Wh/m² -> kWh/m²
      const dniAnnualKwh = dniSum / 1000;

      yearly.push({
        year,
        annualGhi: ghiAnnualKwh,
        annualDni: dniAnnualKwh,
        ghiDaily: ghiAnnualKwh / 365,
        dniDaily: dniAnnualKwh / 365,
        hoursRecorded: count
      });
    }

    if (!yearly.length) return res.status(204).end();

    const avgGhi = yearly.reduce((s, y) => s + y.ghiDaily, 0) / yearly.length;
    const avgDni = yearly.reduce((s, y) => s + y.dniDaily, 0) / yearly.length;
    const variance = yearly.reduce((s, y) => s + (y.ghiDaily - avgGhi) ** 2, 0) / yearly.length;

    return res.status(200).json({
      years: yearly,
      avgGhi,
      avgDni,
      stdDev: Math.sqrt(variance),
      yearsIncluded: yearly.length
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: String(e?.message || e) });
  }
}
