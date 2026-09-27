# Parcel Atlas · 匹兹堡地块探索

Track 1 的第一步原型：在匹兹堡地图上查看县级地块边界和市级规划分区，点击或搜索地块后查看地块编号、面积及所选位置的分区。

## 运行

需要 Node.js 20.19+ 或 22.12+。

```bash
npm install
npm run dev
```

打开 Vite 显示的本地地址（默认 `http://localhost:5173`）。构建和运行生产版本：

```bash
npm run build
npm start
```

生产版默认监听 `http://localhost:8787`，可用 `PORT` 环境变量修改。地图需要网络连接，以加载底图和官方 GIS 服务。

## 数据来源与处理

- [阿勒格尼县地块边界](https://data.wprdc.org/dataset/allegheny-county-parcel-boundaries1)：页面提供的县级完整 GeoJSON 约 444 MB。应用改为按当前地图范围请求[县 GIS 地块接口](https://gisdata.alleghenycounty.us/arcgis/rest/services/OPENDATA/Parcels/MapServer/0)，只显示缩放级别 16 及以上的地块。
- [匹兹堡规划分区](https://data.wprdc.org/dataset/zoning)：按当前视野请求[市 GIS 分区接口](https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/PGHWebZoning/FeatureServer/0)。分区只覆盖匹兹堡市内。
- 底图：CARTO / OpenStreetMap，通过 Leaflet 显示。

县地块数据页给出的 PASDA 实时地图接口在开发时返回“service not started”，因此此原型使用县政府自身提供的 GIS 接口。没有把完整数据文件放入仓库。

分区结果是**点击位置**的空间查询，不是正式的整块地法规划分区结论。地块可能跨越多个分区，且用途、叠加区和例外需查阅现行法规并由主管部门确认。此阶段不生成 Development Ease Score，也不提供许可结论。

## 已实现的交互

- 城市总览及市中心示例定位
- 地块边界、分区图层开关
- 放大后按视野加载地块；点击查看地块编号、面积和位置分区
- 按完整 PIN 或 Block / Lot 编号搜索地块
- 加载和错误提示、窄屏布局

## AI 使用说明

此阶段的界面和代码由 OpenAI Codex 辅助编写。地图数据直接来自上述公开 GIS 接口；没有使用 AI 生成或修改地块、分区事实。
