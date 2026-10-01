// 毎朝 GitHub Actions から実行し、regions.json の地域の天気を weather.json に書き出す。
import { readFile, writeFile } from 'node:fs/promises';
import { fetchRegions } from '../weather-core.js';

const regions = JSON.parse(await readFile(new URL('../regions.json', import.meta.url), 'utf8'));
const data = await fetchRegions(regions);
if (!data.regions.length) {
  console.error('天気を1か所も取得できませんでした');
  process.exit(1);
}
data.source = 'morning';
await writeFile(new URL('../weather.json', import.meta.url), JSON.stringify(data, null, 2) + '\n');
console.log('updated', data.regions.map((r) => r.name).join(', '));
