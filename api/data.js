// /api/data.js
// Vercel serverless function (Node.js runtime).
// Fetches the 3 sheets directly from Google Sheets (CSV export) and
// transforms them into the exact JSON shape the frontend expects:
//   { page1: { regions, new_zones, funnel }, page2: { days, filters, totals, date_range } }
//
// This mirrors the logic previously done offline in Python (extract5.py).

import Papa from 'papaparse';

const SHEET_ID = process.env.SHEET_ID || '1HoDVHBNXi8F87ZsQF-ELwsQ2DtWDc2fEVf6CRFA-X2Q';
const GID_SBB = process.env.GID_SBB || '0';
const GID_PIPELINE = process.env.GID_PIPELINE || '904170512';
const GID_REQUIRED = process.env.GID_REQUIRED || '1227635779';

const OPS_POS = {
  'SBB คนเก่งพลัส_กิจกรรม': 'activity',
  'SBB คนเก่งพลัส_BE': 'be',
  'ผู้ช่วยทีม': 'assistant',
  'ม้าเร็ว': 'rider',
  'สาวบาวแดง': 'sales',
};
const LEADER_MAIN = 'หัวหน้าทีมเชียร์';
const LEADER_BACKUP = 'ทลต.หัวหน้าทีมเชียร์';
const DEPUTY_MAIN = 'รองผู้จัดการ Operation';
const DEPUTY_BACKUP = 'ทลต.รองผู้จัดการ Operation';
const POS_MAP_PIPE = { 'สาวบาวเบียร์': 'sales', 'ม้าเร็ว': 'rider', 'ผู้ช่วยทีม': 'assistant' };
const TRAIN_SUBS = new Set(['ระหว่างฝึกงาน', 'ต่อฝึกงาน']);

function csvUrl(gid) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
}

async function fetchCsv(gid, label) {
  const url = csvUrl(gid);
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) {
    throw new Error(
      `โหลดข้อมูลชีต "${label}" ไม่สำเร็จ (HTTP ${res.status}). ตรวจสอบว่า Google Sheet ตั้งค่าแชร์เป็น "Anyone with the link - Viewer" แล้ว`
    );
  }
  const text = await res.text();
  if (text.trim().startsWith('<')) {
    throw new Error(
      `ชีต "${label}" อาจไม่ได้เปิดสิทธิ์ public — ได้ HTML กลับมาแทน CSV ตรวจสอบการตั้งค่าแชร์ของ Google Sheet`
    );
  }
  const parsed = Papa.parse(text, { skipEmptyLines: 'greedy' });
  return parsed.data; // array of arrays (raw rows including header)
}

// Convert "D/M/YYYY" (as displayed by Google Sheets export) -> { date: Date, iso: "YYYY-MM-DD" }
function parseThaiSheetDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const dd = d.padStart(2, '0');
  const mm = mo.padStart(2, '0');
  return { iso: `${y}-${mm}-${dd}` };
}

function cell(row, idx) {
  const v = row[idx];
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

function regionToBigregionFallback(zone) {
  if (!zone) return 'อื่นๆ';
  if (zone.startsWith('กรุงเทพ') || zone.startsWith('ธนบุรี')) return 'กรุงเทพมหานคร';
  if (zone.startsWith('นนทบุรี') || zone.startsWith('ปทุมธานี') || zone.startsWith('สมุทรปราการ')) return 'ปริมณฑล';
  if (zone.startsWith('ชลบุรี') || zone.startsWith('ระยอง')) return 'ตะวันออก';
  if (zone.startsWith('ขอนแก่น') || zone.startsWith('นครราชสีมา') || zone.startsWith('อุดรธานี') || zone.startsWith('อุบลราชธานี')) return 'อีสาน';
  if (zone.startsWith('เชียงใหม่') || zone.startsWith('เชียงราย') || zone.startsWith('พิษณุโลก')) return 'เหนือ';
  if (zone.startsWith('ภูเก็ต') || zone.startsWith('ประจวบคีรีขันธ์') || zone.startsWith('สุราษฎร์ธานี')) return 'ใต้';
  if (zone.startsWith('อยุธยา') || zone.startsWith('นครปฐม')) return 'กลาง';
  return 'อื่นๆ';
}

function classifyStage(status, sub) {
  if (status === 'รอเข้ามารายงานตัว') return 'รอเข้ารายงานตัว';
  if (status === 'ไม่มารายงานตัว') return 'ไม่มารายงานตัว';
  if (status === 'มารายงานตัว') {
    if (sub === 'ผ่านฝึกงาน-บรรจุ') return 'บรรจุแล้ว';
    if (sub === 'ไม่ผ่านฝึกงาน' || sub === 'ยกเลิกฝึกงาน') return 'ไม่ผ่าน/ยกเลิก';
    return 'อยู่ระหว่างฝึกงาน';
  }
  return 'อื่นๆ';
}

function buildData(requiredRows, sbbRows, pipeRows) {
  // ---------- 1. canonical team list (กำลังพลที่ต้องการ) ----------
  // header: ภูมิภาค, ทีมย่อย, หัวหน้าทีมเชียร์, กำลังพลที่ต้องการ, สถานะทีม
  // NOTE: all teams (Active and otherwise) are kept here so the roster ("กำลังพล") page
  // retains full visibility. The "รีพอท" report page is responsible for filtering down
  // to Active-only teams when computing its summary counts.
  const canonical = [];
  for (let i = 1; i < requiredRows.length; i++) {
    const row = requiredRows[i];
    const region = cell(row, 0);
    if (!region) continue;
    const team = cell(row, 1);
    const head = cell(row, 2);
    const required = parseInt(cell(row, 3), 10) || 0;
    const statusRaw = cell(row, 4) || 'Active';
    const isActive = statusRaw.toLowerCase() === 'active';
    canonical.push({ region, team, head, required, status: statusRaw, is_active: isActive });
  }
  const canonicalTeamNames = new Set(canonical.map((c) => c.team));
  const regionOrder = [];
  canonical.forEach((c) => { if (!regionOrder.includes(c.region)) regionOrder.push(c.region); });

  // ---------- 2. main SBB active employees ----------
  // header: code, name, position, start_date, last_date, zone, region, head, reason, Workplace
  const teamStats = {};
  canonical.forEach((c) => { teamStats[c.team] = { activity: 0, be: 0, assistant: 0, rider: 0, sales: 0 }; });

  const regionZoneMeta = {}; // zone -> {leaderNames:Map, leaderBackupNames:Map, deputyCount, deputyBackupCount}
  const teamZone = {}; // team -> zone

  for (let i = 1; i < sbbRows.length; i++) {
    const row = sbbRows[i];
    const code = cell(row, 0);
    if (!code) continue;
    const name = cell(row, 1);
    const position = cell(row, 2);
    const lastDate = cell(row, 4);
    const zone = cell(row, 5);
    const region = cell(row, 6);
    const head = cell(row, 7);

    if (lastDate !== null) continue; // not active
    if (!zone) continue;

    if (!region) {
      if (!regionZoneMeta[zone]) {
        regionZoneMeta[zone] = { leaderNames: new Map(), leaderBackupNames: new Map(), deputyCount: 0, deputyBackupCount: 0 };
      }
      const zm = regionZoneMeta[zone];
      if (position === LEADER_MAIN) zm.leaderNames.set(name, (zm.leaderNames.get(name) || 0) + 1);
      else if (position === LEADER_BACKUP) zm.leaderBackupNames.set(name, (zm.leaderBackupNames.get(name) || 0) + 1);
      else if (position === DEPUTY_MAIN) zm.deputyCount += 1;
      else if (position === DEPUTY_BACKUP) zm.deputyBackupCount += 1;
      continue;
    }

    if (!teamStats[region]) continue; // team not in canonical list, skip (defensive)
    teamZone[region] = zone;
    if (OPS_POS[position]) {
      teamStats[region][OPS_POS[position]] += 1;
    }
    void head; // head from canonical sheet takes priority; SBB head unused here
  }

  // first canonical team per zone -> receives leader/deputy backup counts
  const zoneFirstTeam = {};
  canonical.forEach((c) => {
    const z = teamZone[c.team];
    if (z && !zoneFirstTeam[z]) zoneFirstTeam[z] = c.team;
  });
  const teamLeaderExtra = {};
  const teamDeputyExtra = {};
  Object.entries(zoneFirstTeam).forEach(([zone, firstTeam]) => {
    const zm = regionZoneMeta[zone] || { leaderNames: new Map(), leaderBackupNames: new Map(), deputyCount: 0, deputyBackupCount: 0 };
    let leaderSum = 0;
    zm.leaderNames.forEach((v) => { leaderSum += v; });
    zm.leaderBackupNames.forEach((v) => { leaderSum += v; });
    teamLeaderExtra[firstTeam] = leaderSum;
    teamDeputyExtra[firstTeam] = zm.deputyCount + zm.deputyBackupCount;
  });

  // ---------- 3. pipeline (ฝึกงาน) ----------
  // header: วันที่สรรหา, ชื่อ นามสกุล, ตำแหน่ง, ทีมย่อย, สถานะรายงานตัว, สถานะฝึกงาน, Owner
  const pipeRowsParsed = [];
  for (let i = 1; i < pipeRows.length; i++) {
    const row = pipeRows[i];
    const status = cell(row, 4);
    if (!status) continue;
    const dateRaw = cell(row, 0);
    const parsedDate = parseThaiSheetDate(dateRaw);
    if (!parsedDate) continue; // skip rows with unparseable/missing date
    pipeRowsParsed.push({
      date: parsedDate.iso,
      name: cell(row, 1) || '',
      position: cell(row, 2),
      team: cell(row, 3),
      status,
      sub: cell(row, 5),
      owner: cell(row, 6) || '-',
    });
  }

  let noShow = 0, pendingTotalAll = 0, reportedTotalAll = 0, placedTotalAll = 0, droppedTotalAll = 0, trainingTotalAll = 0;
  pipeRowsParsed.forEach((r) => {
    if (r.status === 'ไม่มารายงานตัว') noShow++;
    if (r.status === 'รอเข้ามารายงานตัว') pendingTotalAll++;
    if (r.status === 'มารายงานตัว') {
      reportedTotalAll++;
      if (r.sub === 'ผ่านฝึกงาน-บรรจุ') placedTotalAll++;
      else if (r.sub === 'ไม่ผ่านฝึกงาน' || r.sub === 'ยกเลิกฝึกงาน') droppedTotalAll++;
      else trainingTotalAll++; // TRAIN_SUBS or null
    }
  });

  const teamPending = {};
  const teamTraining = {};
  canonical.forEach((c) => {
    teamPending[c.team] = { assistant: 0, rider: 0, sales: 0 };
    teamTraining[c.team] = { assistant: 0, rider: 0, sales: 0 };
  });
  const newZoneTraining = {}; // team -> {assistant,rider,sales}

  pipeRowsParsed.forEach((r) => {
    const bucket = POS_MAP_PIPE[r.position] || 'other';
    const team = r.team;
    const inCanon = canonicalTeamNames.has(team);
    if (r.status === 'รอเข้ามารายงานตัว') {
      if (inCanon && bucket !== 'other') teamPending[team][bucket] += 1;
    } else if (r.status === 'มารายงานตัว' && (TRAIN_SUBS.has(r.sub) || r.sub === null)) {
      if (inCanon) {
        if (bucket !== 'other') teamTraining[team][bucket] += 1;
      } else if (team) {
        if (!newZoneTraining[team]) newZoneTraining[team] = { assistant: 0, rider: 0, sales: 0 };
        if (bucket !== 'other') newZoneTraining[team][bucket] += 1;
      }
    }
  });

  // ---------- 4. build page1 regions ----------
  const regionsMap = {};
  regionOrder.forEach((r) => { regionsMap[r] = []; });

  canonical.forEach((c) => {
    const st = teamStats[c.team];
    const pend = teamPending[c.team];
    const train = teamTraining[c.team];
    const currentTotal = st.activity + st.be + st.assistant + st.rider + st.sales;
    const pendingTotal = pend.assistant + pend.rider + pend.sales;
    const trainingTotal = train.assistant + train.rider + train.sales;
    regionsMap[c.region].push({
      team: c.team,
      head: c.head,
      required: c.required,
      status: c.status,
      is_active: c.is_active,
      activity: st.activity,
      be: st.be,
      assistant: st.assistant,
      rider: st.rider,
      sales: st.sales,
      leader_backup: teamLeaderExtra[c.team] || 0,
      deputy_backup: teamDeputyExtra[c.team] || 0,
      current_total: currentTotal,
      p_assistant: pend.assistant,
      p_rider: pend.rider,
      p_sales: pend.sales,
      pending_total: pendingTotal,
      t_assistant: train.assistant,
      t_rider: train.rider,
      t_sales: train.sales,
      training_total: trainingTotal,
      grand_total: currentTotal + pendingTotal + trainingTotal,
    });
  });

  const regionsList = regionOrder.map((r) => ({ bigregion: r, teams: regionsMap[r] }));

  const newZonesGrouped = {};
  Object.entries(newZoneTraining).forEach(([team, counts]) => {
    const br = regionToBigregionFallback(team);
    if (!newZonesGrouped[br]) newZonesGrouped[br] = [];
    const total = counts.assistant + counts.rider + counts.sales;
    newZonesGrouped[br].push({ team, assistant: counts.assistant, rider: counts.rider, sales: counts.sales, training_total: total });
  });
  const newZonesList = Object.entries(newZonesGrouped).map(([bigregion, teams]) => ({
    bigregion,
    teams: teams.sort((a, b) => b.training_total - a.training_total),
  }));

  const funnel = {
    no_show: noShow,
    pending_total_all: pendingTotalAll,
    reported_total_all: reportedTotalAll,
    training_total_all: trainingTotalAll,
    placed_total_all: placedTotalAll,
    dropped_total_all: droppedTotalAll,
  };

  const page1 = { regions: regionsList, new_zones: newZonesList, funnel };

  // ---------- 5. page2: daily recruitment ----------
  pipeRowsParsed.forEach((r) => { r.stage = classifyStage(r.status, r.sub); });

  const byDate = {};
  pipeRowsParsed.forEach((r) => {
    if (!byDate[r.date]) byDate[r.date] = [];
    byDate[r.date].push({ name: r.name, position: r.position, team: r.team || '-', status: r.status, sub: r.sub, stage: r.stage, owner: r.owner });
  });
  const datesSorted = Object.keys(byDate).sort().reverse();
  const dailyList = datesSorted.map((d) => {
    const recs = byDate[d];
    const byPosition = {};
    const byStage = {};
    recs.forEach((r) => {
      if (r.position) byPosition[r.position] = (byPosition[r.position] || 0) + 1;
      byStage[r.stage] = (byStage[r.stage] || 0) + 1;
    });
    return { date: d, count: recs.length, by_position: byPosition, by_stage: byStage, records: recs };
  });

  const allPositions = [...new Set(pipeRowsParsed.map((r) => r.position).filter(Boolean))].sort();
  const allOwners = [...new Set(pipeRowsParsed.map((r) => r.owner).filter(Boolean))].sort();
  const allTeamsPipe = [...new Set(pipeRowsParsed.map((r) => r.team).filter(Boolean))].sort();

  const ownerTotals = {};
  const positionTotals = {};
  const stageTotals = {};
  pipeRowsParsed.forEach((r) => {
    if (r.owner) ownerTotals[r.owner] = (ownerTotals[r.owner] || 0) + 1;
    if (r.position) positionTotals[r.position] = (positionTotals[r.position] || 0) + 1;
    stageTotals[r.stage] = (stageTotals[r.stage] || 0) + 1;
  });

  const page2 = {
    days: dailyList,
    filters: { positions: allPositions, owners: allOwners, teams: allTeamsPipe },
    totals: { count: pipeRowsParsed.length, by_owner: ownerTotals, by_position: positionTotals, by_stage: stageTotals },
    date_range: datesSorted.length ? { min: datesSorted[datesSorted.length - 1], max: datesSorted[0] } : { min: null, max: null },
  };

  return { page1, page2, generated_at: new Date().toISOString() };
}

export { buildData };

export default async function handler(req, res) {
  try {
    const [requiredRows, sbbRows, pipeRows] = await Promise.all([
      fetchCsv(GID_REQUIRED, 'กำลังพลที่ต้องการ'),
      fetchCsv(GID_SBB, 'SBB'),
      fetchCsv(GID_PIPELINE, 'ฝึกงาน'),
    ]);

    const data = buildData(requiredRows, sbbRows, pipeRows);

    // Edge-cache for 5 minutes, allow stale-while-revalidate for 1 hour
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: true, message: err.message || String(err) });
  }
}
