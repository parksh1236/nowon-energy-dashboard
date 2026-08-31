import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const readJson = async path => JSON.parse(await readFile(new URL(path, root), "utf8"));
const writeJson = async (path, value) => writeFile(new URL(path, root), JSON.stringify(value));
const number = value => {
  const parsed = value === "-" || value == null ? NaN : Number(String(value).replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const day = (yearMonth, label) => {
  const match = label.match(/^(\d{2})월 (\d{2})일$/);
  if (!match) throw new Error(`알 수 없는 일자 형식: ${label}`);
  if (`${yearMonth.slice(0, 4)}-${match[1]}` !== yearMonth) throw new Error(`조회 월 불일치: ${yearMonth} / ${label}`);
  return `${yearMonth.slice(0, 4)}-${match[1]}-${match[2]}`;
};
const metadataByName = new Map([
  ["공릉2동어린이집", { address: "공릉로 34길 73", contractPowerKw: 150, solarKw: 10 }],
  ["노원어린이집", { address: "동일로 239 다길 23", contractPowerKw: 25, solarKw: 6 }],
  ["상계4동어린이집", { address: "덕릉로 130길 6", contractPowerKw: 50, solarKw: null }],
  ["상계5동보듬이나눔이어린이집", { address: "한글비석로 39길 16-5", contractPowerKw: 69, solarKw: null }],
  ["월계1동어린이집", { address: "석계로69", contractPowerKw: 40, solarKw: 7 }],
  ["월계2동어린이집", { address: "월계로45길21", contractPowerKw: 25, solarKw: null }],
  ["월계3동어린이집", { address: "마들로 31", contractPowerKw: 32, solarKw: 0.9 }],
  ["중계행복어린이집", { address: "중계로 8길 17", contractPowerKw: 49, solarKw: 3 }],
  ["청솔창의어린이집", { address: "공릉로59가길 13", contractPowerKw: 35, solarKw: 3 }],
  ["하계어린이집", { address: "공릉로58마길 1", contractPowerKw: 40, solarKw: 20 }],
]);
const harvest = await readJson("powerplanner-harvest.local.json");
const facilities = await readJson("data/facilities.json");
const monthlyAll = await readJson("data/monthly.json");
const yearlyAll = await readJson("data/yearly.json");
let nextId = Math.max(...facilities.map(({ id }) => id)) + 1;
const baseDay = (await readJson("data/summary.json")).baseDay;

for (const [offset, source] of harvest.entries()) {
  const existing = facilities.find(facility => facility.name === source.name);
  const id = existing?.id ?? nextId++;
  const metadata = metadataByName.get(source.name);
  if (!metadata) throw new Error(`시설 부가정보 없음: ${source.name}`);
  const daily = Object.entries(source.daily).flatMap(([yearMonth, rows]) => rows.map(([label, usage, previous, cost]) => ({
    day: day(yearMonth, label),
    usage_kwh: number(usage),
    prev_year_usage_kwh: number(previous),
    cost_won: number(cost),
    temp_max: null,
    temp_min: null,
    contract_power_kw: metadata.contractPowerKw,
    peak_kw: null,
    solar_kwh: null,
  }))).sort((a, b) => a.day.localeCompare(b.day));
  const monthly = source.monthly.map(([year, label, usage, previous]) => ({
    year_month: `${year}-${label.match(/^(\d{1,2})월/)[1].padStart(2, "0")}`,
    usage_kwh: number(usage),
    prev_year_usage_kwh: number(previous),
    cost_won: null,
    prev_year_cost_won: null,
  })).sort((a, b) => a.year_month.localeCompare(b.year_month));
  const scrapedYearly = source.yearly.filter(([year]) => /^\d{4}년$/.test(year)).map(([year, usage, co2]) => ({
    year: year.replace("년", ""),
    usage_kwh: number(usage) ?? 0,
    co2_ton: number(co2) ?? 0,
  })).sort((a, b) => a.year.localeCompare(b.year));
  const yearlyTotals = monthly.filter(({ usage_kwh }) => usage_kwh != null).reduce((totals, row) => totals.set(row.year_month.slice(0, 4), (totals.get(row.year_month.slice(0, 4)) ?? 0) + row.usage_kwh), new Map());
  const yearly = scrapedYearly.length ? scrapedYearly : [...yearlyTotals].map(([year, usage]) => ({ year, usage_kwh: usage, co2_ton: usage * 0.0004541 }));
  const base = daily.find(({ day }) => day === baseDay);
  const facility = {
    id,
    name: source.name,
    facilityType: "어린이집",
    address: metadata.address,
    floorAreaM2: null,
    note: null,
    solarKw: metadata.solarKw,
    solarOn: metadata.solarKw != null,
    usagePerAreaKwhM2: null,
    status: source.status === "ok" ? "ok" : "error",
    lastRunAt: "2026-08-31 15:00:00",
    lastErrorMessage: source.status === "ok" ? null : "파워플래너 로그인 실패",
    baseDay,
    yesterdayUsageKwh: base?.usage_kwh ?? null,
    yesterdayCostWon: base?.cost_won ?? null,
    prevYearSameDayKwh: base?.prev_year_usage_kwh ?? null,
  };

  const replace = (items, value) => {
    const index = items.findIndex(item => item.id === id);
    index < 0 ? items.push(value) : items.splice(index, 1, value);
  };
  replace(facilities, facility);
  replace(monthlyAll, { id, name: source.name, facilityType: "어린이집", monthly });
  replace(yearlyAll, { id, name: source.name, facilityType: "어린이집", yearly });
  await mkdir(new URL(`data/facilities/${id}/daily/`, root), { recursive: true });
  await writeJson(`data/facilities/${id}/readings.json`, []);
  await writeJson(`data/facilities/${id}/monthly.json`, monthly);
  await writeJson(`data/facilities/${id}/yearly.json`, yearly);
  for (const yearMonth of Object.keys(source.daily)) {
    await writeJson(`data/facilities/${id}/daily/${yearMonth}.json`, daily.filter(({ day }) => day.startsWith(yearMonth)));
  }
}

await writeJson("data/facilities.json", facilities);
await writeJson("data/monthly.json", monthlyAll);
await writeJson("data/yearly.json", yearlyAll);
const current = facilities.filter(({ baseDay: day }) => day === baseDay);
const sum = key => Number(current.reduce((total, item) => total + (item[key] ?? 0), 0).toFixed(3));
await writeJson("data/summary.json", {
  baseDay,
  yesterdayUsageKwh: sum("yesterdayUsageKwh"),
  yesterdayCostWon: sum("yesterdayCostWon"),
  prevYearSameDayKwh: sum("prevYearSameDayKwh"),
  facilityCount: facilities.length,
  errorCount: facilities.filter(({ status }) => status === "error").length,
});
