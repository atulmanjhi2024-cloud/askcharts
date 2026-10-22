import { compute } from "../lib/indicators.js";
import { VolumeProfile } from "./volume-profile.js";
import { ICON_BY_ID, STICKER_BY_ID } from "./emojis.js";

// Drawing tools, rendered as a Lightweight Charts series primitive. Points are stored as
// { time (UTC seconds), price } so drawings stay put when you change timeframe.

// Elliott wave icons: a small zigzag with its first and last labels on top.
const EW_ICON = (first, last) =>
  `<path d="M3.5 18.5l3.6-5 3 3 4-5.5 3 3 3.4-4.5"/><circle cx="3.5" cy="18.5" r="1.2"/><circle cx="10.1" cy="16.5" r="1.2"/><circle cx="17.1" cy="14" r="1.2"/><text x="5.5" y="9" font-size="6.5" font-family="sans-serif" font-weight="700" fill="currentColor" stroke="none">${first}</text><text x="17.5" y="7.5" font-size="6.5" font-family="sans-serif" font-weight="700" fill="currentColor" stroke="none">${last}</text>`;

export const TOOLS = [
  { id: "cursor", label: "Cursor", icon: '<path d="M5 3l14 7-6 2-2 6z"/>' },
  // Trend tools (TradingView's first flyout). The older ids keep their names so saved drawings
  // and line alerts still match.
  { id: "trend", label: "Trendline", points: 2, icon: '<path d="M5.6 18.4L18.4 5.6"/><circle cx="4.5" cy="19.5" r="1.6"/><circle cx="19.5" cy="4.5" r="1.6"/>' },
  { id: "ray", label: "Ray", points: 2, icon: '<path d="M6.1 17.9l3.8-3.8M12.1 11.9l8.4-8.4"/><circle cx="5" cy="19" r="1.6"/><circle cx="11" cy="13" r="1.6"/>' },
  { id: "info", label: "Info line", points: 2, icon: '<path d="M5.6 16.4l8.8-8.8"/><circle cx="4.5" cy="17.5" r="1.6"/><circle cx="15.5" cy="6.5" r="1.6"/><rect x="14.5" y="14.5" width="6.5" height="5" rx="1.6"/>' },
  { id: "extended", label: "Extended line", points: 2, icon: '<path d="M3 21l3.9-3.9M9.1 14.9l5.8-5.8M17.1 6.9L21 3"/><circle cx="8" cy="16" r="1.6"/><circle cx="16" cy="8" r="1.6"/>' },
  { id: "angle", label: "Trend angle", points: 2, icon: '<path d="M5.6 18.4L18.4 5.6M6.1 19.5H20M10.6 19.5a6 6 0 0 0-1.8-4.3"/><circle cx="4.5" cy="19.5" r="1.6"/><circle cx="19.5" cy="4.5" r="1.6"/>' },
  { id: "hline", label: "Horizontal line", points: 1, icon: '<path d="M3 12h7.4M13.6 12H21"/><circle cx="12" cy="12" r="1.6"/>' },
  { id: "hray", label: "Horizontal ray", points: 1, icon: '<path d="M6.6 12H21"/><circle cx="5" cy="12" r="1.6"/>' },
  { id: "vline", label: "Vertical line", points: 1, icon: '<path d="M12 3v7.4M12 13.6V21"/><circle cx="12" cy="12" r="1.6"/>' },
  { id: "cross", label: "Crossline", points: 1, icon: '<path d="M3 12h7.4M13.6 12H21M12 3v7.4M12 13.6V21"/><circle cx="12" cy="12" r="1.6"/>' },
  { id: "channel", label: "Parallel channel", points: 3, icon: '<path d="M6.1 11.9l5.8-5.8M8 19l3.9-3.9M14.1 12.9L20 7"/><circle cx="5" cy="13" r="1.6"/><circle cx="13" cy="5" r="1.6"/><circle cx="13" cy="14" r="1.6"/>' },
  { id: "regression", label: "Regression trend", points: 2, icon: '<path d="M4 9.5l16-6v11l-16 6z"/><path d="M5.6 14.4l12.8-4.8"/><circle cx="4" cy="15" r="1.6"/><circle cx="20" cy="9" r="1.6"/>' },
  { id: "flattop", label: "Flat top/bottom", points: 3, icon: '<path d="M6.1 10.4l11.8-4.8M6.6 18h10.8"/><circle cx="4.6" cy="11" r="1.6"/><circle cx="19.4" cy="5" r="1.6"/><circle cx="5" cy="18" r="1.6"/><circle cx="19" cy="18" r="1.6"/>' },
  { id: "disjoint", label: "Disjoint channel", points: 3, icon: '<path d="M6.5 9.4l11-4.3M6.5 14.6l11 4.3"/><circle cx="5" cy="10" r="1.6"/><circle cx="19" cy="4.5" r="1.6"/><circle cx="5" cy="14" r="1.6"/><circle cx="19" cy="19.5" r="1.6"/>' },
  { id: "pitchfork", label: "Pitchfork", points: 3, icon: '<path d="M5 19l13-13M7 10l6-6M14 17l7-7M7 12l5 5"/><circle cx="4" cy="20" r="1.4"/><circle cx="6" cy="11" r="1.4"/><circle cx="13" cy="18" r="1.4"/>' },
  { id: "schiff", label: "Schiff pitchfork", points: 3, icon: '<path d="M5.4 19.5H12M8 15l10-10M7 10l6-6M14 17l7-7M7 12l5 5"/><circle cx="4" cy="19.5" r="1.4"/><circle cx="6" cy="11" r="1.4"/><circle cx="13" cy="18" r="1.4"/>' },
  { id: "mschiff", label: "Modified Schiff pitchfork", points: 3, icon: '<path d="M5.4 20.5H12M9 16l9-9M7 10l6-6M14 17l7-7M7 12l5 5"/><circle cx="4" cy="20.5" r="1.4"/><circle cx="8" cy="16.5" r="1.4"/><circle cx="6" cy="11" r="1.4"/><circle cx="13.4" cy="20.5" r="1.4"/>' },
  { id: "insidefork", label: "Inside pitchfork", points: 3, icon: '<path d="M5.4 20H17M8 15V4M11.5 13V3M15 15V5M8 15l3.5-2 3.5 2"/><circle cx="4" cy="20" r="1.4"/><circle cx="18.4" cy="20" r="1.4"/><circle cx="11.5" cy="13" r="1.4"/>' },

  // Gann and Fibonacci tools (TradingView's second flyout). "fib" keeps its old id.
  { id: "fib", label: "Fib retracement", points: 2, icon: '<path d="M3 5h15M3 10h18M3 14h18M6 19h15"/><circle cx="19.5" cy="5" r="1.5"/><circle cx="4.5" cy="19" r="1.5"/>' },
  { id: "fibext", label: "Trend-based fib extension", points: 3, icon: '<path d="M5 11.4V7.1M6.5 5.4l11-1.8M4 15h16M4 18h16M4 21h16"/><circle cx="5" cy="13" r="1.5"/><circle cx="5" cy="5.6" r="1.5"/><circle cx="19" cy="3.4" r="1.5"/>' },
  { id: "fibchannel", label: "Fib channel", points: 3, icon: '<path d="M5.4 10.4l12.2-5.2M4 15.5l16-7M4 20.5l16-7"/><circle cx="4" cy="11" r="1.5"/><circle cx="19" cy="4.6" r="1.5"/>' },
  { id: "fibtime", label: "Fib time zone", points: 2, icon: '<path d="M4 3v6.5M4 12.5V21M5.2 12.4l2.3 3.2M9.5 3v12.5M9.5 18.5V21M14 3v18M20 3v18"/><circle cx="4" cy="11" r="1.5"/><circle cx="9.5" cy="17" r="1.5"/>' },
  { id: "fibfan", label: "Fib speed resistance fan", points: 2, icon: '<path d="M4.5 18V3.5M6 19.5h14.5M5.5 18.5L19 5M5.5 18.5L20 11.5M5.5 18.5L12 3.5"/><circle cx="4.5" cy="19.5" r="1.5"/><circle cx="19.5" cy="4.5" r="1.5"/>' },
  { id: "fibtrendtime", label: "Trend-based fib time", points: 3, icon: '<path d="M4.6 6.4l3.3 11.2M10 19.5h1M14 3v18M17.5 3v18M21 3v18"/><circle cx="4" cy="4.5" r="1.5"/><circle cx="8.5" cy="19.5" r="1.5"/><circle cx="12.5" cy="19.5" r="1.5"/>' },
  { id: "fibcircles", label: "Fib circles", points: 2, icon: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="2.5"/><circle cx="6" cy="18" r="1.4"/><circle cx="18" cy="6" r="1.4"/>' },
  { id: "fibspiral", label: "Fib spiral", points: 2, icon: '<path d="M13.5 12a1.5 1.5 0 0 0-3 0 3 3 0 0 0 6 0 4.5 4.5 0 0 0-9 0 6 6 0 0 0 12 0"/><circle cx="12" cy="12" r="1.2"/><circle cx="19.5" cy="12" r="1.4"/>' },
  { id: "fibarcs", label: "Fib speed resistance arcs", points: 2, icon: '<path d="M3 10a9 9 0 0 0 18 0M6.5 10a5.5 5.5 0 0 0 11 0M9.5 10a2.5 2.5 0 0 0 5 0"/><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="15.5" r="1.4"/>' },
  { id: "fibwedge", label: "Fib wedge", points: 3, icon: '<path d="M5 17.5V5M6.5 19H19.5M5 12a7 7 0 0 1 7 7M5 8a11 11 0 0 1 11 11"/><circle cx="5" cy="19" r="1.5"/><circle cx="5" cy="3.5" r="1.5"/><circle cx="21" cy="19" r="1.5"/>' },
  { id: "pitchfan", label: "Pitchfan", points: 3, icon: '<path d="M5.1 18.9L19 5M5.1 18.9L13 4.5M5.1 18.9L20 12M9 4l12 12"/><circle cx="4" cy="20" r="1.5"/><circle cx="8" cy="3.5" r="1.4"/><circle cx="21" cy="17" r="1.4"/>' },
  { id: "gannbox", label: "Gann box", points: 2, icon: '<rect x="4" y="5" width="15" height="15"/><path d="M9 5v15M14 5v15M4 10h15M4 15h15"/><circle cx="4" cy="20" r="1.5"/><circle cx="19" cy="5" r="1.5"/>' },
  { id: "gannfixed", label: "Gann square fixed", points: 2, icon: '<rect x="4" y="4" width="16" height="16"/><path d="M4 20L20 4M4 20l16-8M4 20l8-16M4 12h16M12 4v16M4 12a8 8 0 0 1 8 8"/><circle cx="4" cy="20" r="1.5"/>' },
  { id: "gannsquare", label: "Gann square", points: 2, icon: '<rect x="4" y="4" width="16" height="16"/><path d="M4 20L20 4M4 20l16-8M4 20l8-16M4 12h16M12 4v16M4 12a8 8 0 0 1 8 8"/><circle cx="4" cy="20" r="1.5"/><circle cx="20" cy="4" r="1.5"/>' },
  { id: "gannfan", label: "Gann fan", points: 2, icon: '<path d="M5.5 18.5L20 4M5.5 18.5L21 10M5.5 18.5L21 15.5M5.5 18.5L14 3M5.5 18.5L9 3"/><circle cx="4.5" cy="19.5" r="1.5"/><circle cx="15.5" cy="8.5" r="1.4"/>' },
  // Patterns (TradingView's third flyout).
  { id: "xabcd", label: "XABCD pattern", points: 5, icon: '<path d="M4.5 19L7 5l5 7 5-7 2.5 14M4.5 19L12 12l7.5 7"/><circle cx="4.5" cy="19" r="1.3"/><circle cx="7" cy="5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="17" cy="5" r="1.3"/><circle cx="19.5" cy="19" r="1.3"/>' },
  { id: "cypher", label: "Cypher pattern", points: 5, icon: '<path d="M4.5 19L7 5l5 7 5-7 2.5 14M4.5 19L12 12l7.5 7"/><circle cx="4.5" cy="19" r="1.3"/><circle cx="7" cy="5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="17" cy="5" r="1.3"/><circle cx="19.5" cy="19" r="1.3"/><text x="9.6" y="22.5" font-size="6.5" font-family="sans-serif" fill="currentColor" stroke="none">c</text>' },
  { id: "headshoulders", label: "Head and shoulders", points: 7, icon: '<path d="M2.5 19L6 10l3 6 3-12 3 12 3-6 3.5 9M5 16h14"/><circle cx="6" cy="10" r="1.2"/><circle cx="12" cy="4" r="1.2"/><circle cx="18" cy="10" r="1.2"/><circle cx="9" cy="16" r="1.2"/><circle cx="15" cy="16" r="1.2"/>' },
  { id: "abcd", label: "ABCD pattern", points: 4, icon: '<path d="M4.5 18.5L7 5.5l9.5 11.5L19.5 5M7 5.5L19.5 5"/><circle cx="4.5" cy="18.5" r="1.4"/><circle cx="7" cy="5.5" r="1.4"/><circle cx="16.5" cy="17" r="1.4"/><circle cx="19.5" cy="5" r="1.4"/>' },
  { id: "trianglepat", label: "Triangle pattern", points: 4, icon: '<path d="M4 4l17 8M4 20l17-8M4 4l3 16M7 20l4-14M11 6l4 11"/><circle cx="4" cy="4" r="1.3"/><circle cx="7" cy="20" r="1.3"/><circle cx="11" cy="6" r="1.3"/><circle cx="15" cy="17" r="1.3"/>' },
  { id: "threedrives", label: "Three drives pattern", points: 7, icon: '<path d="M3 5l2.5 12L8 8l3 10 2.5-9 3 11L20 4"/><circle cx="5.5" cy="17" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="11" cy="18" r="1.2"/><circle cx="13.5" cy="9" r="1.2"/><circle cx="16.5" cy="20" r="1.2"/><circle cx="20" cy="4" r="1.2"/>' },
  { id: "ewimpulse", label: "Elliott impulse wave (1·2·3·4·5)", points: 6, icon: EW_ICON("1", "5") },
  { id: "ewcorrection", label: "Elliott correction wave (A·B·C)", points: 4, icon: EW_ICON("A", "C") },
  { id: "ewtriangle", label: "Elliott triangle wave (A·B·C·D·E)", points: 6, icon: EW_ICON("A", "E") },
  { id: "ewdouble", label: "Elliott double combo wave (W·X·Y)", points: 4, icon: EW_ICON("W", "Y") },
  { id: "ewtriple", label: "Elliott triple combo wave (W·X·Y·X·Z)", points: 6, icon: EW_ICON("W", "Z") },
  { id: "cyclic", label: "Cyclic lines", points: 2, icon: '<path d="M5 3v7.6M5 13.4V21M10 3v7.6M10 13.4V21M15 3v18M20 3v18"/><circle cx="5" cy="12" r="1.4"/><circle cx="10" cy="12" r="1.4"/>' },
  { id: "timecycles", label: "Time cycles", points: 2, icon: '<path d="M2 8a5 5 0 0 0 10 0 5 5 0 0 0 10 0"/><circle cx="7" cy="13" r="1.4"/><circle cx="17" cy="13" r="1.4"/>' },
  { id: "sine", label: "Sine line", points: 2, icon: '<path d="M2.5 13C4 4 7 4 8.6 11.4M9.6 13.6C11.4 20 14.6 20 16.4 12S20 4 21.5 11"/><circle cx="5.6" cy="6" r="1.3"/><circle cx="12.4" cy="18" r="1.3"/>' },
  // Forecasting, volume-based tools and measurers (TradingView's fourth flyout). "long", "short"
  // and "measure" keep their ids so saved drawings still load.
  { id: "long", label: "Long position", points: 2, icon: '<path d="M6.5 5H20M4 12h16M6.5 19H20"/><circle cx="5" cy="5" r="1.5"/><circle cx="5" cy="19" r="1.5"/><text x="10" y="10.4" font-size="6.5" font-family="sans-serif" font-weight="700" fill="currentColor" stroke="none">L</text>' },
  { id: "short", label: "Short position", points: 2, icon: '<path d="M6.5 5H20M4 12h16M6.5 19H20"/><circle cx="5" cy="5" r="1.5"/><circle cx="5" cy="19" r="1.5"/><text x="10" y="17.6" font-size="6.5" font-family="sans-serif" font-weight="700" fill="currentColor" stroke="none">S</text>' },
  { id: "forecast", label: "Position forecast", points: 2, icon: '<path d="M6 4v3M6 16v4M11 3v4M11 15v3M16 5v2M16 10v2M16 15v2M19 7v2M19 12v2"/><rect x="4.5" y="7" width="3" height="9" rx=".5"/><rect x="9.5" y="7" width="3" height="8" rx=".5"/>' },
  { id: "barspattern", label: "Bars pattern", points: 2, icon: '<path d="M5 4v3M5 16v4M10 3v4M10 14v4M15 5v3M15 15v3M20 4v3M20 13v4"/><rect x="3.5" y="7" width="3" height="9" rx=".5"/><rect x="8.5" y="7" width="3" height="7" rx=".5"/><rect x="13.5" y="8" width="3" height="7" rx=".5"/><rect x="18.5" y="7" width="3" height="6" rx=".5"/>' },
  { id: "ghostfeed", label: "Ghost feed", points: 0, icon: '<path d="M4.3 17.3L7 15M9 11v-2M9 17v2M13 8V6M13 15v2M17 6V4M17 12v2"/><rect x="7.5" y="11" width="3" height="6" rx=".5"/><rect x="11.5" y="8" width="3" height="7" rx=".5"/><rect x="15.5" y="6" width="3" height="6" rx=".5"/><circle cx="3.3" cy="18.2" r="1.3"/><circle cx="20.5" cy="6.5" r="1.3"/>' },
  { id: "sector", label: "Sector", points: 3, icon: '<path d="M5 6.5V17.5M6.5 19H17.5M5 5a14 14 0 0 1 14 14"/><circle cx="5" cy="5" r="1.5"/><circle cx="5" cy="19" r="1.5"/><circle cx="19" cy="19" r="1.5"/>' },
  { id: "avwapdraw", label: "Anchored VWAP", points: 1, icon: '<path d="M4.3 17.3L20 8M10 5V3M10 16v4M15 7V3M15 14v3"/><rect x="8.5" y="5" width="3" height="11" rx=".5"/><rect x="13.5" y="7" width="3" height="7" rx=".5"/><circle cx="3.3" cy="18" r="1.3"/>' },
  { id: "fixedvp", label: "Fixed range volume profile", points: 2, icon: '<path d="M4 3v13.5M4 5h5M4 8h7M4 11h4M4 14h3M19 6.5V21"/><circle cx="4" cy="18" r="1.4"/><circle cx="19" cy="5" r="1.4"/>' },
  { id: "anchoredvp", label: "Anchored volume profile", points: 1, icon: '<path d="M5.4 12H20M20 4v16M20 7h-4M20 10h-6M20 13h-8M20 16h-3"/><circle cx="4" cy="12" r="1.4"/>' },
  { id: "pricerange", label: "Price range", points: 2, icon: '<path d="M4 5h14.6M5.4 19H20M12 6v12M9.5 8.5L12 6l2.5 2.5M9.5 15.5L12 18l2.5-2.5"/><circle cx="20" cy="5" r="1.4"/><circle cx="4" cy="19" r="1.4"/>' },
  { id: "daterange", label: "Date range", points: 2, icon: '<path d="M4 4v14.6M19 5.4V20M5 12h13M15.5 9.5L18 12l-2.5 2.5"/><circle cx="4" cy="20" r="1.4"/><circle cx="19" cy="4" r="1.4"/>' },
  { id: "measure", label: "Date and price range", points: 2, icon: '<rect x="4" y="4" width="16" height="16"/><path d="M12 6v12M6 12h12M10 8l2-2 2 2M16 10l2 2-2 2"/><circle cx="4" cy="20" r="1.4"/><circle cx="20" cy="4" r="1.4"/>' },
  // Brushes, arrows and shapes (TradingView's fifth flyout). "rect" keeps its id.
  { id: "brush", label: "Brush", points: 0, freehand: true, icon: '<path d="M3.5 19.6c3.2.1 5.3-1.1 6.4-3.3l5.4-5.4 2.3 2.3-5.4 5.4c-2.1 1.1-4.6 1.3-8.7 1z"/><path d="M15.3 10.9l2.1-2.6c.8-1 2.2-1.6 3.3-1.5"/>' },
  { id: "highlighter", label: "Highlighter", points: 0, freehand: true, icon: '<path d="M4 20.5h7M6.2 17.6l2.7 2.7M6.2 17.6l9.6-9.6 3 3-9.6 9.6M15.8 8l2.4-3.8 3.4 3.4-3.8 2.4"/>' },
  { id: "arrowmarker", label: "Arrow marker", points: 2, icon: '<path d="M3.8 20.6l9.6-11.4-1.9-1.7L20 4l-2.9 8.4-1.7-1.9L4.8 21.4z"/>' },
  { id: "arrow", label: "Arrow", points: 2, icon: '<path d="M5.5 18.5L18 6M12.5 6.5H18V12"/><circle cx="4.5" cy="19.5" r="1.4"/>' },
  { id: "arrowup", label: "Arrow mark up", points: 1, icon: '<path d="M12 4l7.5 7.5H15V20H9v-8.5H4.5z"/>' },
  { id: "arrowdown", label: "Arrow mark down", points: 1, icon: '<path d="M12 20l7.5-7.5H15V4H9v8.5H4.5z"/>' },
  { id: "rect", label: "Rectangle", points: 2, icon: '<path d="M6.5 5h11M6.5 19h11M5 6.5v11M19 6.5v11"/><circle cx="5" cy="5" r="1.5"/><circle cx="19" cy="5" r="1.5"/><circle cx="5" cy="19" r="1.5"/><circle cx="19" cy="19" r="1.5"/>' },
  { id: "rotrect", label: "Rotated rectangle", points: 3, icon: '<path d="M10.9 4.1L4.1 10.9M13.1 4.1l6.8 6.8M19.9 13.1l-6.8 6.8M10.9 19.9l-6.8-6.8"/><circle cx="12" cy="3" r="1.5"/><circle cx="21" cy="12" r="1.5"/><circle cx="12" cy="21" r="1.5"/><circle cx="3" cy="12" r="1.5"/>' },
  { id: "path", label: "Path", points: 0, icon: '<path d="M2.5 16.5l5-5.5 4.5 4.5 7.5-8M15.5 7h4v4"/><circle cx="7.5" cy="11" r="1.3"/><circle cx="12" cy="15.5" r="1.3"/>' },
  { id: "circle", label: "Circle", points: 2, icon: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="1.4"/><circle cx="20.5" cy="12" r="1.4"/>' },
  { id: "ellipse", label: "Ellipse", points: 3, icon: '<ellipse cx="12" cy="12" rx="9" ry="5.5"/><circle cx="3" cy="12" r="1.4"/><circle cx="21" cy="12" r="1.4"/><circle cx="12" cy="6.5" r="1.4"/><circle cx="12" cy="17.5" r="1.4"/>' },
  { id: "polyline", label: "Polyline", points: 0, closable: true, icon: '<path d="M5.4 8.6l5.2-3.2M13.4 5.4l4.2 1.8M19 8.4l-.6 6.6M17.2 16.4l-5.4 3M10.4 19l-4.8-3.2M4.4 14.4V9.6"/><circle cx="4.4" cy="8" r="1.3"/><circle cx="12" cy="4.6" r="1.3"/><circle cx="19" cy="7.6" r="1.3"/><circle cx="18.3" cy="16.2" r="1.3"/><circle cx="11" cy="20" r="1.3"/><circle cx="4.4" cy="15.6" r="1.3"/>' },
  { id: "triangle", label: "Triangle", points: 3, icon: '<path d="M5 5.5v12.5M6.5 19.5h12M6.1 4.6l13 13.8"/><circle cx="5" cy="4" r="1.5"/><circle cx="5" cy="19.5" r="1.5"/><circle cx="20" cy="19.5" r="1.5"/>' },
  { id: "arc", label: "Arc", points: 3, icon: '<path d="M5.2 19.2C6 11.5 11.5 5.8 18.6 5.1"/><path d="M5 19.5l14-14" stroke-dasharray="2 2"/><circle cx="4.5" cy="19.7" r="1.4"/><circle cx="19.5" cy="5" r="1.4"/><circle cx="9.6" cy="9.7" r="1.4"/>' },
  { id: "curve", label: "Curve", points: 3, icon: '<path d="M4.8 18.4C5.5 11 10.5 6.4 18 5.6"/><circle cx="4.5" cy="19.8" r="1.4"/><circle cx="19.5" cy="5.4" r="1.4"/>' },
  { id: "doublecurve", label: "Double curve", points: 4, icon: '<path d="M5.8 19.6c6.4.6 6.6-3.3 4.9-6-1.8-3 .2-8.6 7.6-8.4"/><circle cx="4.4" cy="19.6" r="1.4"/><circle cx="19.6" cy="5.2" r="1.4"/>' },
  // Text and notes, and content (TradingView's sixth flyout). "text" keeps its id.
  { id: "text", label: "Text", points: 1, editOnPlace: true, icon: '<path d="M5 6V4.5h14V6M12 4.5v15M9.5 19.5h5"/>' },
  { id: "note", label: "Note", points: 2, editOnPlace: true, icon: '<rect x="4" y="3.5" width="16" height="11" rx="1.5"/><path d="M9 6.5h6M12 6.5v5.5M12 14.5v4"/><circle cx="12" cy="20" r="1.4"/>' },
  { id: "pricenote", label: "Price note", points: 2, icon: '<rect x="4" y="3.5" width="16" height="11" rx="1.5"/><path d="M14 6.5h-3a1.2 1.2 0 0 0 0 2.4h2a1.2 1.2 0 0 1 0 2.4h-3M12 5.3v1.2M12 11.3v1.2M12 14.5v4"/><circle cx="12" cy="20" r="1.4"/>' },
  { id: "pin", label: "Pin", points: 1, icon: '<path d="M12 21s-6-6.2-6-11a6 6 0 0 1 12 0c0 4.8-6 11-6 11z"/><circle cx="12" cy="10" r="2.4"/>' },
  { id: "table", label: "Table", points: 1, icon: '<rect x="3.5" y="5" width="17" height="14" rx="1"/><path d="M3.5 9.7h17M3.5 14.3h17M9 5v14"/>' },
  { id: "callout", label: "Callout", points: 2, editOnPlace: true, icon: '<path d="M5.5 5h13A1.5 1.5 0 0 1 20 6.5v8a1.5 1.5 0 0 1-1.5 1.5H9.5L5 20v-4h-.5A1.5 1.5 0 0 1 3 14.5"/><path d="M3 14.5v-8A1.5 1.5 0 0 1 4.5 5h1"/>' },
  { id: "comment", label: "Comment", points: 1, editOnPlace: true, icon: '<path d="M4.5 18.5V12a6.5 6.5 0 0 1 6.5-6.5h3a6.5 6.5 0 0 1 0 13z"/>' },
  { id: "pricelabel", label: "Price label", points: 1, icon: '<path d="M8 5.5h12v10H11l-3.6 3.2"/><path d="M8 5.5v8"/><circle cx="5.5" cy="20" r="1.4"/>' },
  { id: "signpost", label: "Signpost", points: 2, editOnPlace: true, icon: '<circle cx="12" cy="9" r="6.5"/><path d="M12 15.5V21M12 5.8l1 2 2.2.3-1.6 1.5.4 2.2-2-1.1-2 1.1.4-2.2-1.6-1.5 2.2-.3z"/>' },
  { id: "flagmark", label: "Flag mark", points: 1, icon: '<path d="M5.5 21V4M5.5 4.5h13l-3 4 3 4h-13"/>' },
  { id: "image", label: "Image", points: 1, icon: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="9.5" r="1.8"/><path d="M3.5 17l5-5 4 4 3-3 5 5"/>' },
  { id: "post", label: "Post", points: 1, icon: '<path d="M4 4h4.5L20 20h-4.5zM19.5 4l-6.6 7.4M11.1 12.6L4.5 20"/>' },
  { id: "idea", label: "Idea", points: 1, icon: '<path d="M9 17h6M9.5 20h5M12 3.5a6 6 0 0 0-3.6 10.8c.5.4.6.9.6 1.5V17h6v-1.2c0-.6.2-1.1.6-1.5A6 6 0 0 0 12 3.5z"/>' },
  // Icons panel (TradingView's seventh button): what was picked is in the drawing's text.
  { id: "emoji", label: "Emoji", points: 1, icon: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.5c1 1.4 2.2 2 3.5 2s2.5-.6 3.5-2M9 9.5v.5M15 9.5v.5"/>' },
  { id: "sticker", label: "Sticker", points: 1, icon: '<rect x="3.5" y="7" width="17" height="10" rx="3"/><path d="M7.5 12h9"/>' },
  { id: "icon", label: "Icon", points: 1, icon: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8L3.5 9.7l5.9-.8z"/>' },
  // The cursor menu's eraser (not a drawing): clicks remove drawings.
  { id: "eraser", label: "Eraser", icon: '<path d="M8 20h12M5.6 15.4l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 19H8.4z"/><path d="M9.6 11.4l5 5"/>' },
  // Measure and Zoom in: drawn while used, never saved.
  { id: "ruler", label: "Measure", points: 2, ephemeral: true, icon: '<path d="M3.6 16.4L16.4 3.6l4 4L7.6 20.4z"/><path d="M7 13l1.6 1.6M9.5 10.5l1.6 1.6M12 8l1.6 1.6M14.5 5.5l1.6 1.6"/>' },
  { id: "zoom", label: "Zoom in", points: 2, ephemeral: true, icon: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5M8 10.5h5M10.5 8v5"/>' },




];
export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
// The drawing bar's flyouts, in TradingView's order and wording.
export const TOOL_GROUPS = [
  {
    id: "lines",
    label: "Trend tools",
    sections: [
      { title: "Lines", items: ["trend", "ray", "info", "extended", "angle", "hline", "hray", "vline", "cross"] },
      { title: "Channels", items: ["channel", "regression", "flattop", "disjoint"] },
      { title: "Pitchforks", items: ["pitchfork", "schiff", "mschiff", "insidefork"] },
    ],
  },
  {
    id: "fibs",
    label: "Gann and Fibonacci tools",
    sections: [
      { title: "Fibonacci", items: ["fib", "fibext", "fibchannel", "fibtime", "fibfan", "fibtrendtime", "fibcircles", "fibspiral", "fibarcs", "fibwedge", "pitchfan"] },
      { title: "Gann", items: ["gannbox", "gannfixed", "gannsquare", "gannfan"] },
    ],
  },
  {
    id: "patterns",
    label: "Patterns",
    sections: [
      { title: "Chart patterns", items: ["xabcd", "cypher", "headshoulders", "abcd", "trianglepat", "threedrives"] },
      { title: "Elliott waves", items: ["ewimpulse", "ewcorrection", "ewtriangle", "ewdouble", "ewtriple"] },
      { title: "Cycles", items: ["cyclic", "timecycles", "sine"] },
    ],
  },
  {
    id: "forecast",
    label: "Forecasting and measurement tools",
    sections: [
      { title: "Forecasting", items: ["long", "short", "forecast", "barspattern", "ghostfeed", "sector"] },
      { title: "Volume-based", items: ["avwapdraw", "fixedvp", "anchoredvp"] },
      { title: "Measurers", items: ["pricerange", "daterange", "measure"] },
    ],
  },
  {
    id: "brushes",
    label: "Geometric shapes",
    sections: [
      { title: "Brushes", items: ["brush", "highlighter"] },
      { title: "Arrows", items: ["arrowmarker", "arrow", "arrowup", "arrowdown"] },
      { title: "Shapes", items: ["rect", "rotrect", "path", "circle", "ellipse", "polyline", "triangle", "arc", "curve", "doublecurve"] },
    ],
  },
  {
    id: "texts",
    label: "Text and notes",
    sections: [
      { title: "Text and notes", items: ["text", "note", "pricenote", "pin", "table", "callout", "comment", "pricelabel", "signpost", "flagmark"] },
      { title: "Content", items: ["image", "post", "idea"] },
    ],
  },
  // Not a menu: its button opens the emoji, sticker and icon panel.
  { id: "emojis", label: "Icons", picker: true, sections: [{ items: ["emoji", "sticker", "icon"] }] },
];
export const GROUP_OF = Object.fromEntries(
  TOOL_GROUPS.flatMap((g) => g.sections.flatMap((s) => s.items.map((id) => [id, g.id]))),
);
// Option (Alt) + letter, as on TradingView.
export const SHORTCUTS = { trend: "T", hline: "H", hray: "J", vline: "V", cross: "C", fib: "F", rect: "Shift+R" };
// What the floating toolbar offers for each tool: line colour, fill colour, text, line width
// (or brush size), line style. The first seven follow TradingView's own toolbars; the rest give
// a tool the controls its drawing actually uses. Tools with fixed level colours (Fibonacci,
// Gann, positions, profiles) get only the common buttons.
const OPT = (spec) => Object.fromEntries(spec.split(" ").filter(Boolean).map((k) => [k, true]));
export const TOOL_OPTIONS = {
  rect: OPT("line fill text width style"),
  rotrect: OPT("line fill width"),
  arrowup: OPT("line text"),
  arrowdown: OPT("line text"),
  arrow: OPT("line text width style"),
  highlighter: OPT("line brush"),
  arrowmarker: OPT("fill text"),
  brush: OPT("line width"),
  ...Object.fromEntries(["trend", "ray", "extended", "hline", "hray", "vline"].map((t) => [t, OPT("line text width style")])),
  ...Object.fromEntries(["info", "angle", "cross", "path", "curve", "doublecurve"].map((t) => [t, OPT("line width style")])),
  ...Object.fromEntries(["channel", "regression", "flattop", "disjoint", "pitchfork", "schiff", "mschiff", "insidefork"].map((t) => [t, OPT("line fill width style")])),
  circle: OPT("line fill text width style"),
  ellipse: OPT("line fill text width style"),
  ...Object.fromEntries(["triangle", "arc", "polyline", "xabcd", "cypher", "headshoulders", "trianglepat"].map((t) => [t, OPT("line fill width")])),
  ...Object.fromEntries(["abcd", "threedrives", "ewimpulse", "ewcorrection", "ewtriangle", "ewdouble", "ewtriple", "cyclic", "timecycles", "sine", "barspattern"].map((t) => [t, OPT("line width")])),
  forecast: OPT("line"),
  ...Object.fromEntries(["pricerange", "daterange", "measure"].map((t) => [t, OPT("line fill width")])),
  // Text and notes: pencil is the border or line, bucket the background, T the text.
  ...Object.fromEntries(["text", "note", "pricenote", "pin", "table", "callout", "signpost"].map((t) => [t, OPT("line fill text")])),
  comment: OPT("fill text"),
  pricelabel: OPT("line fill"),
  flagmark: OPT("line"),
  emoji: OPT("size"),
  sticker: OPT("size"),
  icon: OPT("line size"),
};
// Where a tool's own text goes.
const TEXT_AT = {
  rect: "box", circle: "box", ellipse: "box",
  trend: "line", ray: "line", extended: "line", arrow: "line",
  hline: "hline", hray: "hray", vline: "vline",
  arrowmarker: "tail", arrowup: "below", arrowdown: "above",
};
// Line styles as canvas dash patterns, scaled to the line width.
const dashOf = (style, w) => (style === "dashed" ? [5 * w, 4 * w] : style === "dotted" ? [w, 2.5 * w] : []);
// Tools drawn from shapeOf(): several lines, fills and labels that drawing and clicking share.
const SHAPED = new Set([
  "info", "angle", "cross", "regression", "flattop", "disjoint", "pitchfork", "schiff", "mschiff", "insidefork",
  ...TOOL_GROUPS[1].sections.flatMap((x) => x.items),
  ...TOOL_GROUPS[2].sections.flatMap((x) => x.items),
  ...TOOL_GROUPS[3].sections.flatMap((x) => x.items),
  ...TOOL_GROUPS[4].sections.flatMap((x) => x.items),
  ...TOOL_GROUPS[5].sections.flatMap((x) => x.items),
  "emoji", "sticker", "icon", "ruler", "zoom",
]);
// TradingView's default Fibonacci levels and colours.
const GRAY = "#787b86";
const FIB = [
  [0, GRAY], [0.236, "#f23645"], [0.382, "#ff9800"], [0.5, "#4caf50"], [0.618, "#089981"], [0.786, "#00bcd4"],
  [1, "#787b86"], [1.618, "#2962ff"], [2.618, "#f23645"], [3.618, "#9c27b0"], [4.236, "#e91e63"],
];
const GANN = { 0: GRAY, 0.25: "#ff9800", 0.382: "#00bcd4", 0.5: "#4caf50", 0.618: "#089981", 0.75: "#2962ff", 1: GRAY };
const CIRCLES = [
  [0.236, "#f23645"], [0.382, "#ff9800"], [0.5, "#089981"], [0.618, "#4caf50"], [0.786, "#00bcd4"], [1, GRAY],
  [1.618, "#2962ff"], [2.618, "#e91e63"], [3.618, "#2962ff"], [4.236, "#e91e63"], [4.618, "#f23645"],
];
const WEDGE = CIRCLES.slice(0, 6).map(([k], i) => [k, ["#f23645", "#ff9800", "#4caf50", "#089981", "#00bcd4", GRAY][i]]);
const TREND_TIME = [
  [0, GRAY], [0.382, "#f23645"], [0.618, "#4caf50"], [1, "#089981"], [1.382, "#00bcd4"], [1.618, GRAY],
  [2, "#2962ff"], [2.382, "#e91e63"], [2.618, "#9c27b0"], [3, "#673ab7"],
];
// Gann square: levels 0 to 5, arcs through grid point (A across, B up), and the fans shown by default.
const SQUARE = [GRAY, "#ff9800", "#00bcd4", "#4caf50", "#089981", GRAY];
const GANN_ARCS = [
  [1, 0, "#ff9800"], [1, 1, "#ff9800"], [1.5, 0, "#ff9800"], [2, 0, "#00bcd4"], [2, 1, "#00bcd4"], [3, 0, "#4caf50"],
  [3, 1, "#4caf50"], [4, 0, "#089981"], [4, 1, "#089981"], [5, 0, "#2962ff"], [5, 1, "#2962ff"],
];
const GANN_FANS = [[2, 1, "#00bcd4"], [1, 1, "#4caf50"], [1, 2, "#089981"]];
// Gann fan: label (time/price), price per time against 1/1, colour.
const GANN_FAN = [
  ["1/8", 8, "#ff9800"], ["1/4", 4, "#089981"], ["1/3", 3, "#4caf50"], ["1/2", 2, "#089981"], ["1/1", 1, "#00bcd4"],
  ["2/1", 1 / 2, "#2962ff"], ["3/1", 1 / 3, "#9c27b0"], ["4/1", 1 / 4, "#e91e63"], ["8/1", 1 / 8, "#f23645"],
];
const SPIRAL = "#00bcd4";
const BLUE = "#2962ff", UP = "#089981", DOWN = "#f23645";
const themeColor = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
// "2024-01-12" for daily bars, with the time for intraday ones.
const when2date = (t) => {
  const d = new Date(t * 1000), p = (n) => String(n).padStart(2, "0");
  return t % 86400 === 0
    ? `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
    : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const volText = (v) => {
  for (const [n, u] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]]) if (Math.abs(v) >= n) return `${Number((v / n).toFixed(3))} ${u}`;
  return String(Math.round(v));
};
// Small seeded random numbers (mulberry32), so made-up candles don't change between frames.
const seeded = (key) => {
  let h = 1779033703;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 3432918353);
  let st = h >>> 0;
  return () => {
    st = (st + 0x6d2b79f5) | 0;
    let t = Math.imul(st ^ (st >>> 15), 1 | st);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
// Volume profile drawings: up and down volume, point of control, edges.
const VP = { up: "#00a5c3", down: "#bc003b" };
const FILL = 0.15;
const DASH = { dash: [4, 4], alpha: 0.7, color: GRAY };
const gannColor = (k) => GANN[k] || "#787b86";
const SMALL = "11px -apple-system, Segoe UI, Roboto, sans-serif";
// Text width in a font (one off-screen canvas, made when first needed).
let meter = null;
const measure = (font, text) => {
  meter ||= document.createElement("canvas").getContext("2d");
  meter.font = font;
  return meter.measureText(text).width;
};
// An X post link: its handle and, from the post id, when it was posted. Any link: its host.
export const parseLink = (url) => {
  const out = {};
  try {
    const u = new URL(url);
    out.host = u.host.replace(/^www\./, "");
    const m = /^\/([^/]+)\/status(?:es)?\/(\d+)/.exec(u.pathname);
    if (m) {
      out.handle = m[1];
      out.time = Math.floor((Number(BigInt(m[2]) >> 22n) + 1288834974657) / 1000);
    }
  } catch {
    /* not a link */
  }
  return out;
};
// "03 Jun '25 · 07:24", as on TradingView's cards.
const cardDate = (t) => {
  const d = new Date(t * 1000), p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())} ${d.toLocaleString("en", { month: "short" })} '${String(d.getFullYear()).slice(2)} · ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const images = new Map();
export const GLYPHS = new Set(["emoji", "sticker", "icon"]);
// Whether (x, y) is inside a polygon (even-odd rule).
const inside = (x, y, poly) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p = poly[i], q = poly[j];
    if (p.y > y !== q.y > y && x < ((q.x - p.x) * (y - p.y)) / (q.y - p.y || 1e-9) + p.x) hit = !hit;
  }
  return hit;
};
const BOLD = "600 12px -apple-system, Segoe UI, Roboto, sans-serif";
const LABEL = "12px -apple-system, Segoe UI, Roboto, sans-serif";
const DOTS = { dash: [1, 3], width: 1 };
// Default colours where TradingView gives a tool its own.
const TYPE_COLOR = {
  headshoulders: "#089981", abcd: "#089981", trianglepat: "#673ab7", threedrives: "#673ab7",
  ewimpulse: "#3d85c6", ewcorrection: "#3d85c6", ewtriangle: "#ff9800", ewdouble: "#6aa84f", ewtriple: "#6aa84f",
  cyclic: "#92cad9", timecycles: "#159980", sine: "#159980",
  brush: "#00bcd4", highlighter: "rgba(242,54,69,0.2)", arrowmarker: "#1e53e5", arrowup: "#089981", arrowdown: "#cc2f3c",
  rect: "#9c27b0", rotrect: "#4caf50", circle: "#ff9800", ellipse: "#f23645", polyline: "#00bcd4", triangle: "#089981",
  arc: "#e91e63", doublecurve: "#673ab7",
  text: "#2962ff", note: "#9598a1", pricenote: "#2962ff", pin: "#2962ff", table: "#787b86", callout: "#0097a7",
  comment: "#2962ff", pricelabel: "#2962ff", signpost: "#787b86", flagmark: "#2962ff",
  icon: "#2962ff",
};
// A drawing's line colour: its own, else the tool's TradingView default.
export const colorOf = (d) => d.color || TYPE_COLOR[d.type] || COLORS.line;
// Elliott wave labels per point (the starting point has none).
const EW_LABELS = {
  ewimpulse: ["", "(1)", "(2)", "(3)", "(4)", "(5)"],
  ewcorrection: ["", "(A)", "(B)", "(C)"],
  ewtriangle: ["", "(A)", "(B)", "(C)", "(D)", "(E)"],
  ewdouble: ["", "(W)", "(X)", "(Y)"],
  ewtriple: ["", "(W)", "(X)", "(Y)", "(X)", "(Z)"],
};
const PITCHFORKS = new Set(["pitchfork", "schiff", "mschiff", "insidefork"]);
const sign = (v) => (v > 0 ? "+" : "");
const span = (sec) => {
  const s = Math.abs(sec),
    d = Math.floor(s / 86400),
    h = Math.floor((s % 86400) / 3600),
    m = Math.round((s % 3600) / 60);
  if (d) return `${d}d${h ? ` ${h}h` : ""}`;
  if (h) return `${h}h${m ? ` ${m}m` : ""}`;
  return m ? `${m}m` : `${Math.round(s)}s`;
};

const COLORS = {
  line: "#2962ff",
  fib: "#787b86",
  up: "rgba(8,153,129,",
  down: "rgba(242,54,69,",
};

export class DrawingLayer {
  constructor(pane) {
    this.pane = pane;
    // where each drawing's text was last drawn (for typing it in place), and the one being typed
    this.textAt = new WeakMap();
    this.tableAt = new WeakMap();
    this.editing = null;
    this.editingCell = null;
    this.items = [];
    this.temp = null;
    this.selected = null;
    this._view = {
      zOrder: () => "top",
      renderer: () => ({
        draw: (target) =>
          target.useMediaCoordinateSpace(({ context, mediaSize }) =>
            this.draw(context, mediaSize),
          ),
      }),
    };
  }

  // --- ISeriesPrimitive ---
  attached({ series, requestUpdate }) {
    this.series = series;
    this.requestUpdate = requestUpdate;
  }
  detached() {
    this.series = null;
  }
  updateAllViews() {}
  paneViews() {
    return [this._view];
  }
  update() {
    this.requestUpdate?.();
    this.pane.app?.drawToolbar?.sync();
  }

  x(t) {
    return this.pane.timeToX(t);
  }
  y(p) {
    return this.series?.priceToCoordinate(p) ?? null;
  }
  // An emoji, sticker or icon on screen: its centre, corner handles and outline (the chart drags
  // the corners to resize it and the middle to move it).
  glyphGeometry(d) {
    if (!GLYPHS.has(d?.type)) return null;
    const pts = d.points.map((p) => ({ x: this.x(p.time), y: this.y(p.price), ...p }));
    if (pts.some((p) => p.x == null || p.y == null)) return null;
    const s = this.shapeOf(d, pts, this._size || { width: 1e5, height: 1e5 });
    return s && { center: pts[0], handles: s.handles, inside: (x, y) => !!s.hitArea && inside(x, y, s.hitArea) };
  }

  // The handles a drawing shows when selected, on screen, as they're drawn (null when it's off the chart).
  handlesOf(d) {
    const pts = d.points.map((p) => ({ x: this.x(p.time), y: this.y(p.price), ...p }));
    if (!pts.length || pts.some((p) => p.x == null || p.y == null)) return null;
    if (!SHAPED.has(d.type)) return pts;
    return this.shapeOf(d, pts, this._size || { width: 1e5, height: 1e5 })?.handles || null;
  }

  // Dragging handle h of drawing d, as on TradingView: each handle reshapes the drawing. Returns a
  // function from the pointer's point (time and price) to the drawing's new points, worked out from
  // its points when the drag started; null when the handle doesn't reshape it (the drag moves it).
  handleDrag(d, h, handles) {
    const orig = d.points.map((p) => ({ ...p })),
      n = orig.length;
    const set = (...idx) => (pt) => orig.map((p, j) => (idx.includes(j) ? { ...p, time: pt.time, price: pt.price } : p));
    switch (d.type) {
      case "brush":
      case "highlighter":
        return this.stretch(orig, h === 0 ? 0 : n - 1, h === 0 ? n - 1 : 0);
      case "ellipse":
      case "rotrect":
        // the width handles set point 3 (the width across the first two)
        if (h >= 2) return set(2);
        break;
      case "fibwedge":
      case "sector":
        if (h === 2) return set(2);
        break;
      case "regression":
      case "barspattern":
      case "avwapdraw":
      case "fixedvp":
      case "anchoredvp":
      case "signpost":
        // handles drawn off the points (on a bar, at the plate) still stand for them, in order
        return set(Math.min(h, n - 1));
      case "flattop":
      case "disjoint":
        // the second line's ends: its level (point 3's price; the disjoint one keeps its slope)
        if (h >= 2)
          return (pt) => orig.map((p, j) => (j === 2 ? { ...p, price: h === 3 && d.type === "disjoint" ? pt.price - (orig[0].price - orig[1].price) : pt.price } : p));
        break;
      case "long":
      case "short":
        return this.positionDrag(d, orig, h);
      case "polyline": {
        // a closed polyline repeats its first point last: both move together
        const closed = n > 3 && orig[0].time === orig[n - 1].time && orig[0].price === orig[n - 1].price;
        if (closed && h === 0) return set(0, n - 1);
        break;
      }
    }
    // A handle drawn at one of the points moves that point. A corner made of one point's time and
    // another's price (a rectangle's) moves that time and that price.
    const hp = handles?.[h];
    if (!hp) return null;
    const at = orig.map((p) => ({ x: this.x(p.time), y: this.y(p.price) }));
    const both = at.findIndex((q) => q.x != null && q.y != null && Math.abs(q.x - hp.x) < 0.5 && Math.abs(q.y - hp.y) < 0.5);
    if (both >= 0) return set(both);
    const ti = at.findIndex((q) => q.x != null && Math.abs(q.x - hp.x) < 0.5),
      pi = at.findIndex((q) => q.y != null && Math.abs(q.y - hp.y) < 0.5);
    if (ti >= 0 && pi >= 0) return (pt) => orig.map((p, j) => ({ ...p, ...(j === ti ? { time: pt.time } : {}), ...(j === pi ? { price: pt.price } : {}) }));
    return null;
  }

  // A freehand stroke by one end: the other end stays put and the stroke stretches to the pointer,
  // across and up or down separately (on screen, so it holds on any price scale).
  stretch(orig, end, fixed) {
    const L = orig.map((p) => this.pane.logicalOf(p.time)),
      Y = orig.map((p) => this.y(p.price));
    if (L.some((v) => v == null) || Y.some((v) => v == null)) return null;
    const scale = (o, f, to) => (Math.abs(o - f) > 1e-6 ? (to - f) / (o - f) : null);
    return (pt) => {
      const nl = this.pane.logicalOf(pt.time),
        ny = this.y(pt.price);
      if (nl == null || ny == null) return orig;
      const sx = scale(L[end], L[fixed], nl),
        sy = scale(Y[end], Y[fixed], ny);
      return orig.map((p, i) => {
        const l = sx == null ? L[i] + nl - L[end] : L[fixed] + (L[i] - L[fixed]) * sx,
          y = sy == null ? Y[i] + ny - Y[end] : Y[fixed] + (Y[i] - Y[fixed]) * sy;
        return { ...p, time: this.pane.timeOfLogical(l) ?? p.time, price: this.series?.coordinateToPrice(y) ?? p.price };
      });
    };
  }

  // Long and Short positions: the entry (point 1), the right edge (point 2's time), the target (the
  // Risk/Reward ratio) and the stop (point 2's price). Moving the entry or the stop keeps the target
  // where it is, as on TradingView.
  positionDrag(d, orig, h) {
    const dir = d.type === "long" ? 1 : -1,
      [A, B] = orig,
      risk0 = Math.abs(A.price - B.price) || A.price * 0.01,
      target = A.price + dir * risk0 * (d.rr || 1);
    const ratio = (entry, stop) => Math.max(0.01, (dir * (target - entry)) / (Math.abs(entry - stop) || entry * 0.01));
    if (h === 0)
      return (pt) => {
        d.rr = ratio(pt.price, B.price);
        return [{ ...A, time: pt.time, price: pt.price }, B];
      };
    if (h === 1) {
      const right = this.x(B.time) >= this.x(A.time) ? 1 : 0;
      return (pt) => orig.map((p, j) => (j === right ? { ...p, time: pt.time } : p));
    }
    if (h === 2)
      return (pt) => {
        d.rr = Math.max(0.01, (dir * (pt.price - A.price)) / risk0);
        return orig;
      };
    if (h === 3)
      return (pt) => {
        // the stop stays on its side of the entry
        const stop = dir > 0 ? Math.min(pt.price, A.price - A.price * 1e-6) : Math.max(pt.price, A.price + A.price * 1e-6);
        d.rr = ratio(A.price, stop);
        return [A, { ...B, price: stop }];
      };
    return null;
  }

  setItems(items) {
    this.items = items || [];
    this.selected = null;
    this.update();
  }

  draw(ctx, size) {
    this._size = size;
    ctx.save();
    ctx.font = "11px -apple-system, Segoe UI, Roboto, sans-serif";
    for (const d of [...this.items, ...(this.temp ? [this.temp] : []), ...(this.ruler ? [this.ruler] : [])]) {
      if (d !== this.temp && d !== this.ruler && !this.shows(d)) continue;
      try {
        this.drawOne(ctx, size, d, d === this.selected || d === this.temp);
      } catch {
        /* off-screen */
      }
    }
    ctx.restore();
  }

  drawOne(ctx, size, d, active) {
    const pts = d.points.map((p) => ({
      x: this.x(p.time),
      y: this.y(p.price),
      ...p,
    }));
    if (pts.some((p) => p.x == null || p.y == null)) return;
    const st = d.style || {},
      // Measure is blue going up and red going down, as on TradingView
      color = d.type === "ruler" ? (d.points[1] && d.points[1].price < d.points[0].price ? DOWN : BLUE) : d.color || TYPE_COLOR[d.type] || COLORS.line;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = st.width || (active ? 2 : 1.5);
    ctx.setLineDash(dashOf(st.dash, ctx.lineWidth));
    const [a, b, c] = pts;
    const line = (x1, y1, x2, y2) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };
    const label = (txt, x, y, align = "left", bg = null) => {
      ctx.textAlign = align;
      ctx.textBaseline = "middle";
      if (bg) {
        const w = ctx.measureText(txt).width + 10;
        ctx.fillStyle = bg;
        ctx.fillRect(
          align === "center" ? x - w / 2 : align === "right" ? x - w : x,
          y - 9,
          w,
          18,
        );
        ctx.fillStyle = "#fff";
        ctx.fillText(
          txt,
          align === "center" ? x : align === "right" ? x - 5 : x + 5,
          y,
        );
        ctx.fillStyle = color;
      } else ctx.fillText(txt, x, y);
    };
    const extend = (p, q, both) => {
      const dx = q.x - p.x,
        dy = q.y - p.y;
      if (dx === 0 && dy === 0) return [p, q];
      const far = 1e5;
      const len = Math.hypot(dx, dy);
      const e2 = { x: p.x + (dx / len) * far, y: p.y + (dy / len) * far };
      const e1 = both
        ? { x: p.x - (dx / len) * far, y: p.y - (dy / len) * far }
        : p;
      return [e1, e2];
    };
    const price = (v) => this.pane.formatPrice(v);

    let handles = pts;
    if (SHAPED.has(d.type)) {
      const s = this.shapeOf(d, pts, size);
      if (!s) return;
      this.paintShape(ctx, s, color, size, st);
      handles = s.handles;
      if (s.editAt) this.textAt.set(d, s.editAt);
      if (s.table) this.tableAt.set(d, s.table);
    } else switch (d.type) {
      case "trend":
        line(a.x, a.y, b.x, b.y);
        break;
      case "ray": {
        const [p, q] = extend(a, b, false);
        line(p.x, p.y, q.x, q.y);
        break;
      }
      case "extended": {
        const [p, q] = extend(a, b, true);
        line(p.x, p.y, q.x, q.y);
        break;
      }
      case "hline":
        line(0, a.y, size.width, a.y);
        label(price(a.price), size.width - 4, a.y - 10, "right");
        break;
      case "hray":
        line(a.x, a.y, size.width, a.y);
        label(price(a.price), size.width - 4, a.y - 10, "right");
        break;
      case "vline":
        line(a.x, 0, a.x, size.height);
        break;
      case "channel": {
        line(a.x, a.y, b.x, b.y);
        if (c) {
          const off =
            c.y - (a.y + ((b.y - a.y) * (c.x - a.x)) / (b.x - a.x || 1));
          line(a.x, a.y + off, b.x, b.y + off);
          ctx.globalAlpha = st.fillAlpha ?? 0.08;
          ctx.fillStyle = st.fill || color;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.lineTo(b.x, b.y + off);
          ctx.lineTo(a.x, a.y + off);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        break;
      }
      default:
        break;
    }
    ctx.setLineDash([]);
    this.drawText(ctx, d, pts, size, color, active);
    if (active) {
      ctx.fillStyle = themeColor("--bg", "#131722");
      ctx.strokeStyle = BLUE;
      ctx.lineWidth = 1.5;
      for (const p of handles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  // Whether a drawing shows on this chart: not hidden, drawings not all hidden (the eye on the
  // left), and not kept to another chart (drawn while sync was off).
  shows(d) {
    return !d.hidden && !this.pane.app?.settings.hideDrawings && !(d.pane && d.pane !== this.pane.cfg?.pid);
  }

  // Where to type a drawing's text, worked out now so it works before the first redraw.
  textSpot(d) {
    if (SHAPED.has(d.type) && this._size) {
      const pts = d.points.map((p) => ({ x: this.x(p.time), y: this.y(p.price), ...p }));
      if (!pts.some((p) => p.x == null || p.y == null)) {
        const s = this.shapeOf(d, pts, this._size);
        if (s?.editAt) return s.editAt;
      }
    }
    return this.textAt.get(d) || null;
  }

  // A drawing's own text: centred in rectangles, circles and ellipses, along lines and arrows,
  // beside arrow marks. A selected box shape with no text shows "+ Add text".
  drawText(ctx, d, pts, size, color, active) {
    const place = TEXT_AT[d.type];
    if (!place || pts.length < (place === "line" ? 2 : 1)) return;
    const st = d.style || {},
      placeholder = !d.text && active && place === "box";
    if ((!d.text && !placeholder) || this.editing === d) return;
    const [a, b] = pts,
      fs = st.fontSize || (d.type === "arrowmarker" ? 16 : 14),
      lines = (d.text || "+ Add text").split("\n"),
      lh = fs * 1.25;
    ctx.save();
    ctx.font = `${d.type === "arrowmarker" ? "600 " : ""}${fs}px -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillStyle = placeholder ? themeColor("--muted", "#787b86") : st.textColor || color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 1;
    let x = a.x, y = a.y;
    if (place === "box") {
      if (d.type !== "circle" && b) ({ x, y } = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      y -= ((lines.length - 1) * lh) / 2;
    } else if (place === "line") {
      let ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
      ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2);
      ctx.rotate(ang);
      x = 0;
      y = -6 - lh / 2 - (lines.length - 1) * lh;
    } else if (place === "hline" || place === "hray") {
      x = place === "hline" ? size.width / 2 : a.x + 10;
      if (place === "hray") ctx.textAlign = "left";
      y = a.y - 6 - lh / 2 - (lines.length - 1) * lh;
    } else if (place === "vline") {
      ctx.translate(a.x, size.height / 2);
      ctx.rotate(-Math.PI / 2);
      x = 0;
      y = -6 - lh / 2 - (lines.length - 1) * lh;
    } else if (place === "tail" && b) {
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1,
        ux = (b.x - a.x) / len,
        uy = (b.y - a.y) / len;
      x = a.x - ux * 10;
      y = a.y - uy * 10 - ((lines.length - 1) * lh) / 2;
      ctx.textAlign = Math.abs(ux) < 0.3 ? "center" : ux > 0 ? "right" : "left";
    } else if (place === "below") y = a.y + 21 + 6 + lh / 2;
    else if (place === "above") y = a.y - 21 - 6 - lh / 2 - (lines.length - 1) * lh;
    lines.forEach((ln, i) => ctx.fillText(ln, x, y + i * lh));
    // screen position of the first line, ignoring any rotation (the editor opens there level)
    const ox = ["line", "vline"].includes(place) ? (place === "vline" ? a.x : (a.x + b.x) / 2) : 0,
      oy = ["line", "vline"].includes(place) ? (place === "vline" ? size.height / 2 : (a.y + b.y) / 2) : 0;
    this.textAt.set(d, { x: ox + x, y: oy + y, align: ctx.textAlign, fs, color: placeholder ? null : st.textColor || color });
    ctx.restore();
  }

  // Pixel geometry for the multi-part trend tools: lines (optionally dashed or faint), fills, arcs,
  // labels, and the handles to show when selected. Derived anchors (the flat line, the disjoint
  // channel's second line) are worked out in price and time, so they hold on any price scale.
  shapeOf(d, pts, size) {
    const [a, b, c] = pts;
    const price = (v) => this.pane.formatPrice(v);
    const ok = (...ps) => ps.every((p) => p && p.x != null && p.y != null);
    const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    const toward = (p, dir, len = 1e4) => ({ x: p.x + dir.x * len, y: p.y + dir.y * len });
    const s = { lines: [], polys: [], paths: [], boxes: [], images: [], icons: [], arcs: [], texts: [], handles: pts };
    const L = (p, q, o = {}) => s.lines.push({ a: p, b: q, ...o });
    const lg = (t) => this.pane.logicalOf(t) ?? NaN;
    const lx = (l) => this.pane.chart.timeScale().logicalToCoordinate(l);
    const unit = (p, q) => {
      const dx = q.x - p.x,
        dy = q.y - p.y,
        l = Math.hypot(dx, dy) || 1;
      return { x: dx / l, y: dy / l };
    };
    // Horizontal levels from x1 to x2, each in its colour with the band from the level before filled.
    const hLevels = (levels, priceAt, x1, x2) => {
      let prev = null;
      for (const [k, col] of levels) {
        const y = this.y(priceAt(k));
        if (y == null) continue;
        if (prev != null) s.polys.push({ pts: [{ x: x1, y: prev }, { x: x2, y: prev }, { x: x2, y }, { x: x1, y }], color: col, alpha: FILL });
        L({ x: x1, y }, { x: x2, y }, { color: col, width: 1 });
        s.texts.push({ text: `${k} (${price(priceAt(k))})`, x: x1 + 4, y: y - 7, color: col, font: SMALL });
        prev = y;
      }
    };
    // Full-height vertical lines at bar positions (fractional allowed), labelled along the bottom.
    const vLevels = (items, fill) => {
      let prev = null;
      for (const [lbl, l, col] of items) {
        const x = lx(l);
        if (fill && x != null && prev != null) s.polys.push({ pts: [{ x: prev, y: 0 }, { x, y: 0 }, { x, y: size.height }, { x: prev, y: size.height }], color: col, alpha: 0.035 });
        prev = x;
        if (x == null || x < -50 || x > size.width + 50) continue;
        L({ x, y: 0 }, { x, y: size.height }, { color: col, width: 1 });
        s.texts.push({ text: lbl, x: x + 4, y: size.height - 12, color: col, font: SMALL });
      }
    };
    // Pattern helpers. pointLabel puts text above a point higher than its neighbours and below a
    // lower one (on a tag in the line colour for chart patterns); ratio draws a dotted line between
    // two points with the ratio on a tag at its middle.
    const poly = () => {
      for (let i = 0; i + 1 < pts.length; i++) L(pts[i], pts[i + 1]);
    };
    const leg = (i, j) => (pts[i] && pts[j] ? Math.abs(pts[j].price - pts[i].price) : NaN);
    const pointLabel = (i, text, tag) => {
      const p = pts[i];
      if (!p) return;
      const nb = [pts[i - 1], pts[i + 1]].filter(Boolean),
        high = !nb.length || p.y <= nb.reduce((t, q) => t + q.y, 0) / nb.length;
      s.texts.push({ text, x: p.x, y: p.y + (high ? -15 : 16), align: "center", font: tag ? LABEL : BOLD, ...(tag ? { bg: true } : {}) });
    };
    const ratio = (i, j, value, decimals = 3) => {
      if (!pts[i] || !pts[j] || !Number.isFinite(value)) return;
      L(pts[i], pts[j], DOTS);
      s.texts.push({ text: String(Number(value.toFixed(decimals))), x: (pts[i].x + pts[j].x) / 2, y: (pts[i].y + pts[j].y) / 2, align: "center", bg: true, font: LABEL });
    };
    // Where line p-q meets line r-s: t along p-q, u along r-s.
    const cross = (p, q, r, s2) => {
      const den = (q.x - p.x) * (s2.y - r.y) - (q.y - p.y) * (s2.x - r.x);
      if (!den) return null;
      const t = ((r.x - p.x) * (s2.y - r.y) - (r.y - p.y) * (s2.x - r.x)) / den,
        u = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / den;
      return { x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y), t, u };
    };
    // Bar positions every step from la, both ways, until off the chart.
    const cycleSteps = (la, step) => {
      const ts = this.pane.chart.timeScale(),
        first = ts.coordinateToLogical(0) ?? la,
        last = ts.coordinateToLogical(size.width) ?? la,
        n = Math.abs(step),
        k0 = Math.floor((Math.min(first, last) - la) / n) - 1,
        k1 = Math.ceil((Math.max(first, last) - la) / n) + 1,
        out = [];
      for (let k = Math.max(k0, -400); k <= Math.min(k1, 400); k++) out.push(la + k * n);
      return out;
    };
    const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
    // A line with an open arrowhead at q.
    const arrowHead = (p, q, o = {}) => {
      const u = unit(q, p),
        n = { x: -u.y, y: u.x };
      L(q, { x: q.x + u.x * 8 + n.x * 5, y: q.y + u.y * 8 + n.y * 5 }, { width: 1, ...o, dash: [] });
      L(q, { x: q.x + u.x * 8 - n.x * 5, y: q.y + u.y * 8 - n.y * 5 }, { width: 1, ...o, dash: [] });
    };
    const arrow = (p, q, o = {}) => {
      L(p, q, { width: 1, ...o });
      if (Math.hypot(q.x - p.x, q.y - p.y) > 10) arrowHead(p, q, o);
    };
    const at = (time, p) => ({ x: this.x(time), y: this.y(p) });
    const active = d === this.selected || d === this.temp;
    // Text helpers for notes and labels.
    const font = (fs, bold) => `${bold ? "600 " : ""}${fs}px -apple-system, Segoe UI, Roboto, sans-serif`;
    const block = (text, fs, bold) => {
      const f = font(fs, bold), lines = String(text).split("\n");
      return { f, fs, lines, lh: fs * 1.25, w: Math.max(...lines.map((l) => measure(f, l))), h: lines.length * fs * 1.25 };
    };
    // Lines of a block with their top-left at (x, y); also where typing opens. A placeholder is faint;
    // hidden (while typing) draws nothing but still marks the spot.
    const putText = (blk, x, y, col, o) => {
      if (!o.hidden) blk.lines.forEach((ln, i) => s.texts.push({ text: ln, x, y: y + blk.lh * (i + 0.5), color: col, font: blk.f, alpha: o.placeholder ? 0.55 : 1 }));
      s.editAt = { x, y: y + blk.lh / 2, align: "left", fs: blk.fs, color: col };
    };
    const fit = (f, text, max) => {
      if (measure(f, text) <= max) return text;
      let t = text;
      while (t.length > 1 && measure(f, `${t}…`) > max) t = t.slice(0, -1);
      return `${t}…`;
    };
    const wrap = (f, text, max) => {
      const out = [];
      for (const para of String(text || "").split("\n")) {
        let line = "";
        for (const word of para.split(/\s+/)) {
          const next = line ? `${line} ${word}` : word;
          if (measure(f, next) > max && line) {
            out.push(line);
            line = word;
          } else line = next;
        }
        out.push(line);
      }
      return out.filter((l, i) => l || i === 0);
    };
    // An ellipse, or part of one, as a path; returns its points (for fills between arcs).
    const ellipse = (cx, cy, rx, ry, a0, a1, o = {}) => {
      const n = Math.max(24, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 60))),
        pts = [];
      for (let i = 0; i <= n; i++) {
        const t = a0 + ((a1 - a0) * i) / n;
        pts.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
      }
      s.paths.push({ pts, ...o });
      return pts;
    };
    // Rays from one point through each target, with the wedge to the previous ray filled.
    const fan = (o, targets) =>
      targets.forEach(([p, col], i) => {
        const far = toward(o, unit(o, p));
        if (i) s.polys.push({ pts: [o, toward(o, unit(o, targets[i - 1][0])), far], color: col, alpha: 0.06 });
        L(o, far, { color: col, width: 1 });
      });
    switch (d.type) {
      case "cross":
        L({ x: 0, y: a.y }, { x: size.width, y: a.y });
        L({ x: a.x, y: 0 }, { x: a.x, y: size.height });
        s.texts.push({ text: price(a.price), x: size.width - 4, y: a.y - 10, align: "right" });
        break;
      case "info": {
        L(a, b);
        if (a.x === b.x && a.y === b.y) break;
        const diff = b.price - a.price,
          pct = a.price ? (diff / a.price) * 100 : 0,
          bars = Math.round((this.pane.logicalOf(b.time) ?? 0) - (this.pane.logicalOf(a.time) ?? 0)),
          deg = (Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI;
        s.texts.push({
          box: [`${sign(diff)}${price(diff)} (${sign(pct)}${pct.toFixed(2)}%)`, `${bars} bars, ${span(b.time - a.time)}`, `${deg.toFixed(2)}°`],
          x: b.x + 10,
          y: b.y + 10,
        });
        break;
      }
      case "angle": {
        L(a, b);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (!len) break;
        const r = Math.max(18, Math.min(60, len * 0.4)),
          theta = Math.atan2(b.y - a.y, b.x - a.x);
        L(a, { x: a.x + r + 24, y: a.y }, { dash: [4, 4], alpha: 0.7 });
        s.arcs.push({ x: a.x, y: a.y, r, to: theta });
        s.texts.push({ text: `${((-theta * 180) / Math.PI).toFixed(2)}°`, x: a.x + r + 28, y: a.y + (theta < 0 ? -10 : 10) });
        break;
      }
      case "regression": {
        // Least squares on the closes between the two clicks, with lines two standard
        // deviations either side (TradingView's defaults).
        const bars = this.pane.shown || [];
        const lo = Math.min(a.time, b.time),
          hi = Math.max(a.time, b.time);
        const i0 = bars.findIndex((x) => x.time >= lo);
        let i1 = i0;
        while (i0 >= 0 && i1 + 1 < bars.length && bars[i1 + 1].time <= hi) i1++;
        const n = i0 < 0 ? 0 : i1 - i0 + 1;
        if (n < 2) {
          L(a, b, { dash: [5, 4] });
          break;
        }
        let sx = 0, sy = 0, sxx = 0, sxy = 0;
        for (let k = 0; k < n; k++) {
          const y = bars[i0 + k].close;
          sx += k; sy += y; sxx += k * k; sxy += k * y;
        }
        const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1),
          icpt = (sy - slope * sx) / n;
        let ss = 0;
        for (let k = 0; k < n; k++) ss += (bars[i0 + k].close - (icpt + slope * k)) ** 2;
        const dev = 2 * Math.sqrt(ss / n),
          t0 = bars[i0].time,
          t1 = bars[i1].time,
          p1 = icpt + slope * (n - 1);
        const A = at(t0, icpt), B = at(t1, p1), Au = at(t0, icpt + dev), Bu = at(t1, p1 + dev), Al = at(t0, icpt - dev), Bl = at(t1, p1 - dev);
        if (!ok(A, B, Au, Bu, Al, Bl)) return null;
        L(Au, Bu);
        L(A, B, { dash: [5, 4] });
        L(Al, Bl);
        s.polys.push({ pts: [Au, Bu, Bl, Al], alpha: 0.1 });
        s.handles = [A, B];
        break;
      }
      case "flattop":
      case "disjoint": {
        // Flat: the third click sets a level across the same span. Disjoint: the second line
        // starts at the third click's price and mirrors the first line's slope.
        L(a, b);
        if (!c) break;
        const c1 = at(a.time, c.price),
          c2 = at(b.time, d.type === "flattop" ? c.price : c.price + (a.price - b.price));
        if (!ok(c1, c2)) break;
        L(c1, c2);
        s.polys.push({ pts: [a, b, c2, c1], alpha: 0.1 });
        s.handles = [a, b, c1, c2];
        break;
      }
      case "fib":
        // Level 0 at point 2, level 1 at point 1.
        L(a, b, DASH);
        hLevels(FIB, (k) => b.price + (a.price - b.price) * k, Math.min(a.x, b.x), Math.max(a.x, b.x));
        break;
      case "fibext": {
        // The first move (point 1 to 2) measured from point 3; lines span points 2 to 3.
        L(a, b, DASH);
        if (!c) break;
        L(b, c, DASH);
        const x1 = Math.min(b.x, c.x),
          x2 = Math.max(b.x, c.x, x1 + 40);
        hLevels(FIB, (k) => c.price + (b.price - a.price) * k, x1, x2);
        break;
      }
      case "fibchannel": {
        // Points 1 and 2 are level 0; each level is that line moved by its share of the step from
        // point 1 to point 3, so level 1 starts at point 3.
        if (!c) {
          L(a, b);
          break;
        }
        const v = { x: c.x - a.x, y: c.y - a.y };
        let prev = null;
        FIB.forEach(([k, col]) => {
          const p = { x: a.x + v.x * k, y: a.y + v.y * k },
            q = { x: b.x + v.x * k, y: b.y + v.y * k },
            left = p.x <= q.x ? p : q;
          if (prev) s.polys.push({ pts: [prev[0], prev[1], q, p], color: col, alpha: FILL });
          L(p, q, { color: col, width: 1 });
          s.texts.push({ text: `${k} (${price(this.series.coordinateToPrice(left.y) ?? NaN)})`, x: left.x + 4, y: left.y - 7, color: col, font: SMALL });
          prev = [p, q];
        });
        break;
      }
      case "fibtime": {
        // Vertical lines at Fibonacci multiples of the bars from point 1 to point 2.
        L(a, b, { ...DASH, width: 1 });
        const la = lg(a.time),
          step = lg(b.time) - la;
        if (!Number.isFinite(step) || !step) break;
        vLevels([0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89].map((n) => [String(n), la + n * step, n ? "#2962ff" : GRAY]), false);
        break;
      }
      case "fibtrendtime": {
        // The bars from point 1 to point 2, projected from point 3 at Fibonacci ratios.
        L(a, b, DASH);
        if (!c) break;
        L(b, c, DASH);
        const step = lg(b.time) - lg(a.time),
          lc = lg(c.time);
        if (!Number.isFinite(step) || !Number.isFinite(lc)) break;
        vLevels(TREND_TIME.map(([k, col]) => [String(k), lc + k * step, col]), true);
        break;
      }
      case "fibfan": {
        // A box between the points split at the speed ratios (1 at point 1, 0 at point 2), and
        // rays from point 1 through each split on the far side and along the far edge.
        const dx = a.x - b.x,
          dy = a.y - b.y;
        if (!dx && !dy) break;
        const K = [1, 0.75, 0.618, 0.5, 0.382, 0.25, 0];
        const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x), top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
        for (const k of K) {
          const col = gannColor(k),
            y = b.y + dy * k,
            x = b.x + dx * k;
          L({ x: a.x, y }, { x: b.x, y }, { color: col, alpha: 0.4, width: 1 });
          L({ x, y: a.y }, { x, y: b.y }, { color: col, alpha: 0.4, width: 1 });
          s.texts.push({ text: String(k), x: left - 5, y, align: "right", color: col, font: SMALL });
          s.texts.push({ text: String(k), x: right + 5, y, align: "left", color: col, font: SMALL });
          s.texts.push({ text: String(k), x, y: top - 9, align: "center", color: col, font: SMALL });
          s.texts.push({ text: String(k), x, y: bottom + 10, align: "center", color: col, font: SMALL });
        }
        fan(a, [...K.map((k) => [{ x: b.x, y: b.y + dy * k }, gannColor(k)]), ...K.slice(0, -1).reverse().map((k) => [{ x: b.x + dx * k, y: b.y }, gannColor(k)])]);
        s.handles = [a, b];
        break;
      }
      case "fibcircles": {
        // Concentric ellipses on the middle of the two points; level 1 fits the box between them,
        // so they're round when the line is at 45 degrees.
        L(a, b, DASH);
        const cx = (a.x + b.x) / 2,
          cy = (a.y + b.y) / 2,
          hx = Math.abs(b.x - a.x) / 2,
          hy = Math.abs(b.y - a.y) / 2;
        if (!hx && !hy) break;
        const rx = hx && hy ? hx : Math.hypot(hx, hy),
          ry = hx && hy ? hy : Math.hypot(hx, hy);
        let prev = null;
        CIRCLES.forEach(([k, col]) => {
          const ring = ellipse(cx, cy, rx * k, ry * k, 0, Math.PI * 2, { color: col, width: 1 });
          s.polys.push({ pts: ring, hole: prev, color: col, alpha: k > 1 ? 0.05 : FILL });
          s.texts.push({ text: String(k), x: cx + rx * k * Math.SQRT1_2 + 3, y: cy - ry * k * Math.SQRT1_2 - 6, color: col, font: SMALL });
          prev = ring;
        });
        break;
      }
      case "fibspiral": {
        // A golden spiral round point 1 through point 2, turning clockwise and growing by phi
        // every quarter turn, with the line from point 1 through point 2 run to the edge.
        const R = Math.hypot(b.x - a.x, b.y - a.y);
        if (!R) break;
        const dir = unit(a, b);
        L(a, toward(a, dir), { color: SPIRAL, width: 1 });
        const th = Math.atan2(dir.y, dir.x),
          PHI = (1 + Math.sqrt(5)) / 2,
          pts = [];
        for (let t = -6 * Math.PI; t <= 2.5 * Math.PI + 1e-9; t += Math.PI / 40) {
          const r = R * PHI ** ((2 * t) / Math.PI);
          pts.push({ x: a.x + r * Math.cos(th + t), y: a.y + r * Math.sin(th + t) });
        }
        s.paths.push({ pts, color: SPIRAL });
        break;
      }
      case "fibarcs": {
        // Half circles round point 1 on point 2's side (above or below), level 1 through point 2.
        L(a, b, DASH);
        const R = Math.hypot(b.x - a.x, b.y - a.y);
        if (!R) break;
        const up = b.y <= a.y,
          from = up ? Math.PI : 0,
          to = up ? 2 * Math.PI : Math.PI;
        let prev = null;
        CIRCLES.forEach(([k, col]) => {
          const arc = ellipse(a.x, a.y, R * k, R * k, from, to, { color: col, width: 1 });
          s.polys.push({ pts: prev ? [...arc, ...[...prev].reverse()] : [...arc, { x: a.x, y: a.y }], color: col, alpha: k > 1 ? 0.05 : FILL });
          s.texts.push({ text: String(k), x: a.x + (b.x - a.x) * k + 4, y: a.y + (b.y - a.y) * k - 7, color: col, font: SMALL });
          prev = arc;
        });
        break;
      }
      case "fibwedge": {
        // Arcs round point 1 between the side through point 2 and the side toward point 3; both
        // sides are as long as point 1 to point 2 (level 1).
        L(a, b, { color: GRAY });
        if (!c) break;
        const R = Math.hypot(b.x - a.x, b.y - a.y);
        if (!R) break;
        L(a, toward(a, unit(a, c), R), { color: GRAY });
        const t0 = Math.atan2(b.y - a.y, b.x - a.x);
        let sweep = Math.atan2(c.y - a.y, c.x - a.x) - t0;
        if (sweep > Math.PI) sweep -= 2 * Math.PI;
        if (sweep < -Math.PI) sweep += 2 * Math.PI;
        let prev = [a];
        WEDGE.forEach(([k, col]) => {
          const arc = ellipse(a.x, a.y, R * k, R * k, t0, t0 + sweep, { color: col, width: 1 });
          s.polys.push({ pts: [...arc, ...[...prev].reverse()], color: col, alpha: FILL });
          s.texts.push({ text: String(k), x: a.x + (b.x - a.x) * k + 4, y: a.y + (b.y - a.y) * k - 7, color: col, font: SMALL });
          prev = arc;
        });
        s.handles = [a, b, toward(a, unit(a, c), R)];
        break;
      }
      case "pitchfan": {
        // A fan from point 1 through the middle of points 2 and 3 (the median) and the 0.5 and 1
        // marks either side; level 1 passes through points 2 and 3.
        if (!c) {
          L(a, b);
          break;
        }
        const M = mid(b, c),
          off = { x: c.x - M.x, y: c.y - M.y };
        L(b, c, { color: GRAY });
        fan(a, [[-1, "#2962ff"], [-0.5, "#00bcd4"], [0, "#f23645"], [0.5, "#00bcd4"], [1, "#2962ff"]].map(([k, col]) => [{ x: M.x + off.x * k, y: M.y + off.y * k }, col]));
        break;
      }
      case "gannbox": {
        // Price and time split at Gann's levels (0 at point 1), labelled on all four sides.
        if (a.x === b.x && a.y === b.y) break;
        const K = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1];
        const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x), top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
        let py = null, px = null;
        for (const k of K) {
          const col = gannColor(k),
            y = a.y + (b.y - a.y) * k,
            x = a.x + (b.x - a.x) * k;
          if (py != null) s.polys.push({ pts: [{ x: a.x, y: py }, { x: b.x, y: py }, { x: b.x, y }, { x: a.x, y }], color: col, alpha: 0.1 });
          if (px != null) s.polys.push({ pts: [{ x: px, y: a.y }, { x, y: a.y }, { x, y: b.y }, { x: px, y: b.y }], color: col, alpha: 0.07 });
          L({ x: a.x, y }, { x: b.x, y }, { color: col, width: 1 });
          L({ x, y: a.y }, { x, y: b.y }, { color: col, width: 1 });
          s.texts.push({ text: String(k), x: left - 5, y, align: "right", color: col, font: SMALL });
          s.texts.push({ text: String(k), x: right + 5, y, align: "left", color: col, font: SMALL });
          s.texts.push({ text: String(k), x, y: top - 9, align: "center", color: col, font: SMALL });
          s.texts.push({ text: String(k), x, y: bottom + 10, align: "center", color: col, font: SMALL });
          py = y;
          px = x;
        }
        break;
      }
      case "gannfixed":
      case "gannsquare": {
        // A 5 by 5 grid from point 1 toward point 2, with Gann's arcs and fans in cell units.
        // Fixed: cells are true squares as wide as the distance to point 2. Gann square: the grid
        // fills the box from point 1 to point 2, so cells stretch with the chart.
        const dx = b.x - a.x,
          dy = b.y - a.y;
        if (!dx && !dy) break;
        const fixed = d.type === "gannfixed",
          side = Math.hypot(dx, dy),
          ex = fixed ? (dx < 0 ? -side : side) : dx / 5,
          ey = fixed ? (dy > 0 ? side : -side) : dy / 5;
        const at = (u, v) => ({ x: a.x + u * ex, y: a.y + v * ey });
        for (let k = 0; k <= 5; k++) {
          L(at(0, k), at(5, k), { color: SQUARE[k], width: 1 });
          L(at(k, 0), at(k, 5), { color: SQUARE[k], width: 1 });
          const t = at(k, 0), p = at(0, k);
          s.texts.push({ text: String(k), x: t.x, y: t.y + (ey < 0 ? 11 : -11), align: "center", color: SQUARE[k], font: SMALL });
          s.texts.push({ text: String(k), x: p.x + (ex < 0 ? 5 : -5), y: p.y, align: ex < 0 ? "left" : "right", color: SQUARE[k], font: SMALL });
        }
        let prev = [at(0, 0)];
        for (const [A, B, col] of GANN_ARCS) {
          const r = Math.hypot(A, B),
            pts = [];
          for (let i = 0; i <= 72; i++) {
            const t = (Math.PI / 2) * (i / 72),
              u = r * Math.cos(t),
              v = r * Math.sin(t);
            if (u <= 5.0001 && v <= 5.0001) pts.push(at(u, v));
          }
          if (pts.length < 2) continue;
          s.paths.push({ pts, color: col, width: 1 });
          s.polys.push({ pts: [...pts, ...[...prev].reverse()], color: col, alpha: 0.08 });
          prev = pts;
        }
        for (const [A, B, col] of GANN_FANS) {
          const f = 5 / Math.max(A, B);
          L(at(0, 0), at(A * f, B * f), { color: col });
        }
        if (!fixed) {
          const range = Math.abs(b.price - a.price),
            bars = Math.abs(lg(b.time) - lg(a.time)) || 1,
            left = Math.min(a.x, b.x), right = Math.max(a.x, b.x), top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
          s.texts.push({ text: price(range), x: left, y: top - 22, color: GRAY, font: SMALL });
          s.texts.push({ text: (range / bars).toPrecision(4), x: right, y: top - 22, align: "right", color: GRAY, font: SMALL });
          s.texts.push({ text: `${Math.round(bars)} bars`, x: right, y: bottom + 22, align: "right", color: GRAY, font: SMALL });
        }
        s.handles = [a, b];
        break;
      }
      case "gannfan": {
        // Gann angles from point 1, labelled time/price; 1/1 runs through point 2, 1/8 is the
        // steepest and 8/1 the flattest.
        const dx = b.x - a.x,
          dy = b.y - a.y;
        if (!dx && !dy) break;
        const ends = GANN_FAN.map(([, r, col]) => [{ x: a.x + dx, y: a.y + dy * r }, col]);
        fan(a, ends);
        GANN_FAN.forEach(([lbl, , col], i) => s.texts.push({ text: lbl, x: ends[i][0].x + (dx >= 0 ? 5 : -5), y: ends[i][0].y, align: dx >= 0 ? "left" : "right", color: col, font: SMALL }));
        s.handles = [a, b];
        break;
      }
      case "pitchfork":
      case "schiff":
      case "mschiff":
      case "insidefork": {
        // Pitchforks. Original: the median runs from point 1 through the middle of points 2 and 3.
        // Schiff: it starts halfway from point 1 toward point 2 in price, at point 1's time.
        // Modified Schiff: it starts at the middle of points 1 and 2. Inside: from the middle of
        // points 1 and 2 to point 3 (TradingView's help). Lines at 0.5 and 1 either side.
        if (!c) {
          L(a, b);
          break;
        }
        const O = d.type === "pitchfork" ? a : d.type === "schiff" ? { x: a.x, y: (a.y + b.y) / 2 } : mid(a, b);
        const M = d.type === "insidefork" ? c : mid(b, c);
        const len = Math.hypot(M.x - O.x, M.y - O.y) || 1,
          dir = { x: (M.x - O.x) / len, y: (M.y - O.y) / len },
          off = { x: b.x - M.x, y: b.y - M.y };
        const level = (k) => ({ x: M.x + off.x * k, y: M.y + off.y * k });
        const LV = [-1, -0.5, 0, 0.5, 1];
        for (let i = 0; i < LV.length - 1; i++) {
          const p = level(LV[i]),
            q = level(LV[i + 1]);
          s.polys.push({ pts: [p, toward(p, dir), toward(q, dir), q], alpha: i % 2 ? 0.1 : 0.05 });
        }
        if (O !== a) L(a, O, { dash: [3, 3], alpha: 0.6 });
        L(O, toward(M, dir));
        for (const k of [-1, -0.5, 0.5, 1]) L(level(k), toward(level(k), dir), Math.abs(k) === 1 ? {} : { alpha: 0.55 });
        L(b, d.type === "insidefork" ? level(-1) : c, { alpha: 0.7 });
        break;
      }
      case "xabcd":
      case "cypher": {
        // X-A-B-C-D with the X-A-B and B-C-D triangles filled and the leg ratios on dotted lines.
        // XABCD: AB/XA, BC/AB, CD/BC, AD/XA. Cypher: AB/XA, XC/XA, CD/BC, CD/XC.
        poly();
        if (pts.length >= 3) s.polys.push({ pts: [pts[0], pts[1], pts[2]], alpha: 0.15 });
        if (pts.length >= 5) s.polys.push({ pts: [pts[2], pts[3], pts[4]], alpha: 0.15 });
        const cy = d.type === "cypher";
        ratio(0, 2, leg(1, 2) / leg(0, 1));
        ratio(1, 3, (cy ? leg(0, 3) : leg(2, 3)) / (cy ? leg(0, 1) : leg(1, 2)));
        ratio(2, 4, leg(3, 4) / leg(2, 3));
        ratio(0, 4, cy ? leg(3, 4) / leg(0, 3) : leg(1, 4) / leg(0, 1));
        "XABCD".split("").forEach((t, i) => pointLabel(i, t, true));
        break;
      }
      case "abcd":
        poly();
        ratio(0, 2, leg(1, 2) / leg(0, 1));
        ratio(1, 3, leg(2, 3) / leg(1, 2));
        "ABCD".split("").forEach((t, i) => pointLabel(i, t, true));
        break;
      case "headshoulders": {
        // Start, left shoulder, trough, head, trough, right shoulder, end. The dotted neckline runs
        // through the troughs and stops where it meets the first and last legs; the humps above it
        // are filled.
        poly();
        if (pts.length >= 5) {
          const n1 = pts[2], n2 = pts[4];
          const cut = (p, q) => {
            const hit = cross(n1, n2, p, q);
            return hit && hit.u >= 0 && hit.u <= 1 ? hit : { x: p.x, y: n1.y + ((n2.y - n1.y) * (p.x - n1.x)) / (n2.x - n1.x || 1) };
          };
          const left = cut(pts[0], pts[1]),
            right = pts.length >= 7 ? cut(pts[6], pts[5]) : n2;
          L(left, right, DOTS);
          s.polys.push({ pts: [left, ...pts.slice(1, Math.min(6, pts.length)), right], alpha: 0.15 });
        }
        pointLabel(1, "Left Shoulder", true);
        pointLabel(3, "Head", true);
        pointLabel(5, "Right Shoulder", true);
        break;
      }
      case "trianglepat": {
        // A-B-C-D; dotted A-C and B-D run on to where they meet, and a dotted upright at A's time
        // closes the filled triangle.
        poly();
        if (pts.length === 4) {
          const [A, B, C, D] = pts,
            apex = cross(A, C, B, D),
            ok = apex && apex.t > 0 && apex.t < 50;
          const bdAtA = { x: A.x, y: B.y + ((D.y - B.y) * (A.x - B.x)) / (D.x - B.x || 1) };
          L(A, ok ? apex : C, DOTS);
          L(ok ? bdAtA : B, ok ? apex : D, DOTS);
          if (ok) {
            L(A, bdAtA, DOTS);
            s.polys.push({ pts: [A, apex, bdAtA], alpha: 0.15 });
          }
        }
        "ABCD".split("").forEach((t, i) => pointLabel(i, t, true));
        break;
      }
      case "threedrives":
        // Ratios of each drive to the retracement before it, on dotted lines between the lows.
        poly();
        ratio(1, 3, leg(2, 3) / leg(1, 2), 2);
        ratio(3, 5, leg(4, 5) / leg(3, 4), 2);
        break;
      case "ewimpulse":
      case "ewcorrection":
      case "ewtriangle":
      case "ewdouble":
      case "ewtriple":
        // Intermediate degree, TradingView's default: (1) (2) ..., the start unlabelled.
        poly();
        EW_LABELS[d.type].forEach((t, i) => t && pointLabel(i, t, false));
        break;
      case "cyclic": {
        // Lines every bar distance from point 1 to point 2, from point 1 onward in that direction.
        const la = lg(a.time),
          step = lg(b.time) - la;
        if (!Number.isFinite(step) || !step) break;
        const ts = this.pane.chart.timeScale(),
          edge = ts.coordinateToLogical(step > 0 ? size.width : 0) ?? la;
        for (let k = 0, l = la; k < 1000 && (step > 0 ? l <= edge + step : l >= edge + step); k++, l += step) {
          const x = lx(l);
          if (x != null) L({ x, y: 0 }, { x, y: size.height });
        }
        break;
      }
      case "timecycles": {
        // Filled half circles standing on point 1's price, as wide as the bars from point 1 to point
        // 2, tiled across the chart.
        const la = lg(a.time),
          step = lg(b.time) - la;
        if (!Number.isFinite(step) || !step) break;
        for (const l of cycleSteps(la, step)) {
          const x0 = lx(l),
            x1 = lx(l + Math.abs(step));
          if (x0 == null || x1 == null) continue;
          const r = Math.abs(x1 - x0) / 2,
            dome = ellipse((x0 + x1) / 2, a.y, r, r, Math.PI, 2 * Math.PI);
          s.polys.push({ pts: dome, color: "#6aa84f", alpha: 0.5 });
        }
        break;
      }
      case "sine": {
        // The two points are a neighbouring crest and trough: half a wave, repeated both ways.
        const half = b.x - a.x;
        if (!half) break;
        const mid = (a.y + b.y) / 2,
          amp = (a.y - b.y) / 2,
          wave = [];
        for (let x = 0; x <= size.width; x += 2) wave.push({ x, y: mid + amp * Math.cos((Math.PI * (x - a.x)) / half) });
        s.paths.push({ pts: wave });
        break;
      }
      case "long":
      case "short": {
        // Entry at point 1; point 2 sets the stop (its price) and the width (its time). The target
        // is Risk/Reward times the stop distance (1 by default, as on TradingView). The bars in the
        // box are played through: the trade opens when price touches the entry and closes at the
        // first touch of target or stop (stop first if one bar touches both).
        const dir = d.type === "long" ? 1 : -1,
          rr = d.rr || 1,
          risk = Math.abs(a.price - b.price) || a.price * 0.01,
          stop = a.price - dir * risk,
          target = a.price + dir * risk * rr,
          x1 = Math.min(a.x, b.x),
          x2 = Math.max(a.x, b.x, x1 + 40),
          ys = this.y(stop),
          yt = this.y(target);
        if (ys == null || yt == null) break;
        s.polys.push({ pts: rect(x1, Math.min(a.y, yt), x2 - x1, Math.abs(yt - a.y)), color: UP, alpha: 0.2 });
        s.polys.push({ pts: rect(x1, Math.min(a.y, ys), x2 - x1, Math.abs(ys - a.y)), color: DOWN, alpha: 0.2 });
        // picked up anywhere in its two boxes, as on TradingView
        s.hitArea = rect(x1, Math.min(yt, ys), x2 - x1, Math.abs(yt - ys));
        L({ x: x1, y: a.y }, { x: x2, y: a.y }, { color: GRAY, width: 1 });
        const bars = this.pane.shown || [],
          tL = Math.min(a.time, b.time),
          tR = Math.max(a.time, b.time);
        let opened = null, exit = null, lastIn = null;
        for (const bar of bars) {
          if (bar.time < tL || bar.time > tR) continue;
          lastIn = bar;
          if (!opened) {
            if (bar.low <= a.price && bar.high >= a.price) opened = bar;
            else continue;
          }
          const hitS = dir > 0 ? bar.low <= stop : bar.high >= stop,
            hitT = dir > 0 ? bar.high >= target : bar.low <= target;
          if (hitS || hitT) {
            exit = { bar, price: hitS ? stop : target, win: !hitS };
            break;
          }
        }
        const endPrice = exit ? exit.price : lastIn?.close;
        if (opened && Number.isFinite(endPrice)) {
          const ox = this.x(opened.time),
            ex = this.x((exit ? exit.bar : lastIn).time),
            ey = this.y(endPrice);
          if (ox != null && ex != null && ey != null) {
            if (exit) {
              const yz = exit.win ? yt : ys;
              s.polys.push({ pts: rect(ox, Math.min(a.y, yz), ex - ox, Math.abs(yz - a.y)), color: exit.win ? UP : DOWN, alpha: 0.2 });
            }
            arrow({ x: ox, y: a.y }, { x: ex, y: ey }, { dash: [4, 4], color: GRAY });
          }
        }
        if (active) {
          // TradingView's stats, shown while the tool is selected: account 1000, 25% at risk.
          const tick = this.tickSize(),
            ticks = (v) => Math.round(v / tick).toLocaleString(),
            pct = (v) => ((v / a.price) * 100).toFixed(3),
            tDist = Math.abs(target - a.price),
            pl = opened && Number.isFinite(endPrice) ? dir * (endPrice - a.price) : 0,
            xc = (x1 + x2) / 2;
          const side = (name, dist, amount, cash, y, col) =>
            s.texts.push({ box: [`${name}: ${price(dist)} (${pct(dist)}%) ${ticks(dist)}, Amount: ${amount}, P&L: ${cash}`], x: xc, y, place: y < a.y ? "above" : "below", center: true, bg: col, gap: 4 });
          side("Target", tDist, Math.round(1000 + 250 * rr), (250 * rr).toFixed(2), yt, UP);
          side("Stop", risk, 750, "-250.00", ys, DOWN);
          s.texts.push({ box: [`${exit ? "Closed" : "Open"} P&L: ${price(pl)}, Qty: ${Math.floor(250 / risk)}`, `Risk/Reward Ratio: ${Number(rr.toFixed(2))}`], x: xc, y: a.y, place: "middle", center: true, bg: pl >= 0 ? UP : DOWN, align: "center" });
        }
        s.handles = [a, { x: x2, y: a.y }, { x: x1, y: yt }, { x: x1, y: ys }];
        break;
      }
      case "forecast": {
        // A curved arrow from the source (point 1) to the target (point 2), with both prices, the
        // change, the time to target, and whether price got there: SUCCESS once a bar after the
        // source reaches the target price by the target time, FAILURE if the time passes first.
        const ctrl = { x: b.x - 0.12 * (b.x - a.x), y: a.y },
          curve = [];
        for (let i = 0; i <= 40; i++) {
          const t = i / 40, u = 1 - t;
          curve.push({ x: u * u * a.x + 2 * u * t * ctrl.x + t * t * b.x, y: u * u * a.y + 2 * u * t * ctrl.y + t * t * b.y });
        }
        s.paths.push({ pts: curve, width: 2 });
        if (curve.length > 2) arrowHead(curve.at(-3), b, { width: 2 });
        if (a.x === b.x && a.y === b.y) break;
        const diff = b.price - a.price,
          days = (b.time - a.time) / 86400,
          when = Math.abs(days) >= 1 ? `${Math.round(days)}d` : span(b.time - a.time);
        s.texts.push({ box: [price(a.price), when2date(a.time)], x: a.x, y: a.y, place: "above", center: true });
        s.texts.push({ box: [`${price(diff)} (${((diff / a.price) * 100).toFixed(2)}%) in ${when}`, `${price(b.price)} ${when2date(b.time)}`], x: b.x, y: b.y, place: "below", center: true });
        const bars = this.pane.shown || [],
          up = b.price >= a.price,
          hit = bars.some((x) => x.time > a.time && x.time <= b.time && (up ? x.high >= b.price : x.low <= b.price)),
          over = (bars.at(-1)?.time ?? 0) >= b.time;
        const st = hit ? ["✓ SUCCESS", "#4caf50", "#fff"] : over ? ["FAILURE", DOWN, "#fff"] : ["IN PROGRESS", "#ead289", "#6d4d22"];
        s.texts.push({ box: [st[0]], x: b.x, y: b.y, place: "below", gap: 54, center: true, bg: st[1], fg: st[2], align: "center" });
        break;
      }
      case "barspattern": {
        // The bars from click 1 to click 2, copied as high-low sticks and lifted so the copy starts
        // at click 1's price (TradingView's default HL mode).
        const bars = this.pane.shown || [],
          t0 = Math.min(a.time, b.time),
          t1 = Math.max(a.time, b.time),
          sel = bars.filter((x) => x.time >= t0 && x.time <= t1);
        if (!sel.length) {
          L(a, b, { dash: [4, 4], color: GRAY, width: 1 });
          break;
        }
        const dy = a.price - sel[0].high;
        for (const bar of sel) {
          const x = this.x(bar.time), yh = this.y(bar.high + dy), yl = this.y(bar.low + dy);
          if (x != null && yh != null && yl != null) L({ x, y: yh }, { x, y: Math.max(yl, yh + 1) }, { width: 2 });
        }
        s.handles = [at(sel[0].time, sel[0].high + dy), at(sel.at(-1).time, sel.at(-1).low + dy)];
        break;
      }
      case "ghostfeed": {
        // Click a path (double-click or Enter to finish); made-up candles follow it, one per bar,
        // their size around the recent average high-low range. The same drawing always gets the
        // same candles.
        for (let i = 0; i + 1 < pts.length; i++) L(pts[i], pts[i + 1], { color: GRAY, width: 1, alpha: 0.7 });
        const recent = (this.pane.shown || []).slice(-50),
          avgHL = recent.reduce((t, x) => t + (x.high - x.low), 0) / (recent.length || 1) || a.price * 0.01,
          rnd = seeded(String(d.id || "ghost"));
        let prev = pts[0].price;
        for (let i = 0; i + 1 < pts.length; i++) {
          const l0 = lg(pts[i].time), l1 = lg(pts[i + 1].time);
          if (!Number.isFinite(l0) || !Number.isFinite(l1)) continue;
          const n = Math.max(1, Math.round(Math.abs(l1 - l0))),
            bw = Math.max(1, Math.abs((lx(l0 + 1) ?? 0) - (lx(l0) ?? 0)) * 0.6);
          for (let k = 1; k <= n; k++) {
            const x = lx(l0 + ((l1 - l0) * k) / n),
              close = pts[i].price + ((pts[i + 1].price - pts[i].price) * k) / n + (rnd() - 0.5) * 0.5 * avgHL,
              open = prev,
              hl = avgHL * (0.5 + rnd()),
              wick = Math.max(0, hl - Math.abs(close - open)),
              hi = Math.max(open, close) + wick * rnd(),
              lo = Math.min(open, close) - wick * rnd(),
              upBar = close >= open;
            prev = close;
            const yo = this.y(open), yc = this.y(close), yh = this.y(hi), yl = this.y(lo);
            if (x == null || [yo, yc, yh, yl].some((v) => v == null)) continue;
            L({ x, y: yh }, { x, y: yl }, { color: GRAY, width: 1, alpha: 0.8 });
            s.polys.push({ pts: rect(x - bw / 2, Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo))), color: upBar ? "#ace5dc" : "#faa1a4", alpha: 0.5 });
          }
        }
        break;
      }
      case "sector": {
        // Point 1 is the centre, point 2 the radius and first edge, point 3 the second edge.
        L(a, b, { color: "#9c9c9c", width: 2 });
        if (!c) break;
        const R = Math.hypot(b.x - a.x, b.y - a.y);
        if (!R) break;
        const t0 = Math.atan2(b.y - a.y, b.x - a.x);
        let sweep = Math.atan2(c.y - a.y, c.x - a.x) - t0;
        if (sweep > Math.PI) sweep -= 2 * Math.PI;
        if (sweep < -Math.PI) sweep += 2 * Math.PI;
        const arc = ellipse(a.x, a.y, R, R, t0, t0 + sweep, { color: GRAY, width: 2 });
        L(a, arc.at(-1), { color: "#9c9c9c", width: 2 });
        s.polys.push({ pts: [a, ...arc], gradient: ["rgba(41,98,255,0.2)", "rgba(156,39,176,0.2)"] });
        s.handles = [a, b, arc.at(-1)];
        break;
      }
      case "avwapdraw": {
        // VWAP of the typical price from the clicked bar on, with the one-deviation band filled.
        const bars = this.pane.shown || [],
          r = compute("avwap", bars, { anchor: a.time, source: "hlc3", band1: 1, band2: 0 }),
          mid = [], up = [], dn = [];
        bars.forEach((bar, i) => {
          const x = this.x(bar.time);
          if (x == null || !Number.isFinite(r.value?.[i])) return;
          const ym = this.y(r.value[i]), yu = this.y(r.upper1[i]), yd = this.y(r.lower1[i]);
          if (ym == null || yu == null || yd == null) return;
          mid.push({ x, y: ym });
          up.push({ x, y: yu });
          dn.push({ x, y: yd });
        });
        if (!mid.length) break;
        s.polys.push({ pts: [...up, ...[...dn].reverse()], color: "#4caf50", alpha: 0.05 });
        s.paths.push({ pts: up, color: "#4caf50", width: 1 }, { pts: dn, color: "#4caf50", width: 1 }, { pts: mid, color: "#1e88e5", width: 1 });
        s.handles = [mid[0]];
        break;
      }
      case "fixedvp":
      case "anchoredvp": {
        // Volume at each price for the bars in the range: 24 rows, up then down volume, the value
        // area (70% of volume around the busiest row) stronger, and the point of control. Fixed
        // range grows from its left edge; the anchored one runs to the latest bar and hangs off the
        // chart's right edge.
        const fixed = d.type === "fixedvp",
          bars = this.pane.shown || [],
          t0 = fixed ? Math.min(a.time, b.time) : a.time,
          t1 = fixed ? Math.max(a.time, b.time) : Infinity,
          inRange = bars.filter((x) => x.time >= t0 && x.time <= t1),
          prof = inRange.length ? VolumeProfile.profile(inRange, 24, 70) : null;
        const xL = fixed ? Math.min(a.x, b.x) : this.x(inRange[0]?.time ?? a.time),
          xR = fixed ? Math.max(a.x, b.x) : this.x(inRange.at(-1)?.time);
        if (!prof || xL == null || xR == null) {
          if (b) L(a, b, { dash: [4, 4], color: GRAY, width: 1 });
          break;
        }
        const yTop = this.y(prof.lo + prof.total.length * prof.step),
          yBot = this.y(prof.lo);
        if (yTop != null && yBot != null) s.polys.push({ pts: rect(xL, yTop, xR - xL, yBot - yTop), color: BLUE, alpha: 0.04 });
        const W = fixed ? (xR - xL) * 0.3 : size.width * 0.3;
        for (let k = 0; k < prof.total.length; k++) {
          const yt = this.y(prof.lo + (k + 1) * prof.step),
            yb = this.y(prof.lo + k * prof.step);
          if (yt == null || yb == null) continue;
          const va = k >= prof.vaLow && k <= prof.vaHigh,
            uw = (prof.up[k] / prof.max) * W,
            dw = (prof.down[k] / prof.max) * W,
            h = Math.max(1, yb - yt - 1),
            al = va ? 0.5 : 0.36;
          if (fixed) {
            s.polys.push({ pts: rect(xL, yt, uw, h), color: VP.up, alpha: al });
            s.polys.push({ pts: rect(xL + uw, yt, dw, h), color: VP.down, alpha: al });
          } else {
            s.polys.push({ pts: rect(size.width - uw, yt, uw, h), color: VP.up, alpha: al });
            s.polys.push({ pts: rect(size.width - uw - dw, yt, dw, h), color: VP.down, alpha: al });
          }
        }
        const yPoc = this.y(prof.lo + (prof.poc + 0.5) * prof.step);
        if (yPoc != null) L({ x: xL, y: yPoc }, { x: size.width, y: yPoc }, { color: themeColor("--text", "#d1d4dc"), width: 2 });
        s.handles = fixed ? [{ x: xL, y: a.y }, { x: xR, y: b.y }] : [{ x: xL, y: a.y }];
        break;
      }
      case "zoom": {
        // the box Zoom in will show (its time and its prices), in TradingView's blue: the fill at 30%,
        // a 1 px edge at 80%, on whole pixels so the edge stays sharp
        const px = (v) => Math.round(v) + 0.5,
          left = px(Math.min(a.x, b.x)), right = px(Math.max(a.x, b.x)), top = px(Math.min(a.y, b.y)), bottom = px(Math.max(a.y, b.y));
        s.polys.push({ pts: rect(left, top, right - left, bottom - top), color: "#2962ff", alpha: 0.3, stroke: "rgba(41, 98, 255, 0.8)", strokeWidth: 1 });
        s.handles = []; // TradingView's zoom box has no handles
        break;
      }
      case "pricerange":
      case "daterange":
      case "ruler":
      case "measure": {
        // A shaded box between the two points with arrows along what's measured, and the result
        // under (or over) the second point: price change, percent and ticks; bars and time; volume.
        const showPrice = d.type !== "daterange",
          showDate = d.type !== "pricerange",
          left = Math.min(a.x, b.x), right = Math.max(a.x, b.x), top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
        s.polys.push({ pts: rect(left, top, right - left, bottom - top), alpha: 0.15 });
        if (d.type === "pricerange") {
          L({ x: left, y: a.y }, { x: right, y: a.y }, { width: 2 });
          L({ x: left, y: b.y }, { x: right, y: b.y }, { width: 2 });
        }
        if (d.type === "daterange") {
          L({ x: a.x, y: top }, { x: a.x, y: bottom }, { width: 2 });
          L({ x: b.x, y: top }, { x: b.x, y: bottom }, { width: 2 });
        }
        if (showPrice) arrow({ x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, { width: 2 });
        if (showDate) arrow({ x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }, { width: 2 });
        const lines = [];
        if (showPrice) {
          const diff = b.price - a.price;
          lines.push(`${price(diff)} (${((diff / a.price) * 100).toFixed(2)}%) ${Math.round(diff / this.tickSize()).toLocaleString()}`);
        }
        if (showDate) {
          const t0 = Math.min(a.time, b.time), t1 = Math.max(a.time, b.time),
            vol = (this.pane.shown || []).reduce((t, x) => (x.time >= t0 && x.time <= t1 ? t + (x.volume || 0) : t), 0);
          lines.push(`${Math.round(lg(b.time) - lg(a.time))} bars, ${span(b.time - a.time)}`, `Vol ${volText(vol)}`);
        }
        s.texts.push({ box: lines, x: (a.x + b.x) / 2, y: b.y < a.y ? top : bottom, place: b.y < a.y ? "above" : "below", center: true, bg: themeColor("--panel", "#1e222d"), fg: themeColor("--text", "#d1d4dc"), shadow: true, align: "center" });
        break;
      }
      case "brush":
      case "highlighter": {
        // Freehand: smoothed (two rounds of corner cutting). The highlighter is a broad
        // see-through stroke with round ends.
        let line = pts;
        for (let k = 0; k < 2 && line.length > 2; k++) {
          const out = [line[0]];
          for (let i = 0; i + 1 < line.length; i++) {
            const p = line[i], q = line[i + 1];
            out.push({ x: 0.75 * p.x + 0.25 * q.x, y: 0.75 * p.y + 0.25 * q.y }, { x: 0.25 * p.x + 0.75 * q.x, y: 0.25 * p.y + 0.75 * q.y });
          }
          out.push(line.at(-1));
          line = out;
        }
        s.paths.push(d.type === "highlighter" ? { pts: line, width: 20, cap: "round" } : { pts: line, width: 2, cap: "round" });
        s.handles = [pts[0], pts.at(-1)];
        break;
      }
      case "arrowmarker": {
        // A solid arrow from point 1 (tail) to point 2 (tip): the shaft widens towards a head with
        // barbs, in TradingView's proportions.
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (!len) break;
        const u = unit(a, b), n = { x: -u.y, y: u.x },
          P2 = (along, half) => ({ x: a.x + u.x * along * len + n.x * half * len, y: a.y + u.y * along * len + n.y * half * len });
        const shape = [P2(0, 0.01), P2(0.725, 0.081), P2(0.745, 0.157), P2(1, 0), P2(0.745, -0.157), P2(0.725, -0.081), P2(0, -0.01)];
        s.polys.push({ pts: shape, alpha: 1 });
        s.hitArea = shape;
        break;
      }
      case "arrow":
        L(a, b, { width: 2 });
        if (Math.hypot(b.x - a.x, b.y - a.y) > 10) {
          const u = unit(b, a), n = { x: -u.y, y: u.x }, k = 15 * Math.SQRT1_2;
          L(b, { x: b.x + (u.x + n.x) * k, y: b.y + (u.y + n.y) * k }, { width: 2 });
          L(b, { x: b.x + (u.x - n.x) * k, y: b.y + (u.y - n.y) * k }, { width: 2 });
        }
        break;
      case "arrowup":
      case "arrowdown": {
        // A fixed-size block arrow with its tip on the point: up arrows hang below it, down arrows
        // sit above it.
        const dir = d.type === "arrowup" ? 1 : -1, x = a.x, y = a.y;
        const shape = [
          { x, y }, { x: x + 9, y: y + 10 * dir }, { x: x + 5, y: y + 10 * dir }, { x: x + 5, y: y + 21 * dir },
          { x: x - 5, y: y + 21 * dir }, { x: x - 5, y: y + 10 * dir }, { x: x - 9, y: y + 10 * dir },
        ];
        s.polys.push({ pts: shape, alpha: 1 });
        s.hitArea = shape;
        break;
      }
      case "rect":
      case "rotrect":
      case "triangle": {
        // Rectangle: two corners. Rotated rectangle: point 1 to 2 is one edge, point 3 the width
        // across it. Triangle: three corners.
        let shape;
        if (d.type === "rect") shape = rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        else if (d.type === "triangle") shape = c ? [a, b, c] : [a, b];
        else {
          if (!c) {
            L(a, b, { width: 2 });
            break;
          }
          const u = unit(a, b), n = { x: -u.y, y: u.x }, w = (c.x - a.x) * n.x + (c.y - a.y) * n.y;
          shape = [a, b, { x: b.x + n.x * w, y: b.y + n.y * w }, { x: a.x + n.x * w, y: a.y + n.y * w }];
          s.handles = [...shape, mid(shape[2], shape[3])];
        }
        shape.forEach((p, i) => L(p, shape[(i + 1) % shape.length], { width: 2 }));
        if (shape.length > 2) {
          s.polys.push({ pts: shape, alpha: 0.2 });
          s.hitArea = shape;
        }
        if (d.type === "rect") s.handles = shape;
        break;
      }
      case "path":
      case "polyline": {
        // Open-ended: click on; double-click, Enter or Esc to finish. A polyline closed by
        // clicking its first point (stored as a repeat of it) is filled.
        poly();
        const closed = d.type === "polyline" && pts.length > 3 && pts[0].time === pts.at(-1).time && pts[0].price === pts.at(-1).price;
        if (closed) {
          s.polys.push({ pts, alpha: 0.2 });
          s.hitArea = pts;
          s.handles = pts.slice(0, -1);
        }
        if (d.type === "path" && pts.length > 1) arrowHead(pts.at(-2), pts.at(-1), { width: 2 });
        break;
      }
      case "circle":
      case "ellipse": {
        // Circle: centre and a point on it, round on screen. Ellipse: points 1 and 2 are the ends of
        // one axis, point 3 sets the width across it.
        let ring;
        if (d.type === "circle") {
          const r = Math.hypot(b.x - a.x, b.y - a.y);
          if (!r) break;
          ring = ellipse(a.x, a.y, r, r, 0, Math.PI * 2, { width: 2 });
        } else {
          if (!c) {
            L(a, b, { width: 2 });
            break;
          }
          const m = mid(a, b), u = unit(a, b), n = { x: -u.y, y: u.x },
            ra = Math.hypot(b.x - a.x, b.y - a.y) / 2,
            rb = Math.abs((c.x - m.x) * n.x + (c.y - m.y) * n.y);
          ring = [];
          for (let i = 0; i <= 120; i++) {
            const t = (Math.PI * 2 * i) / 120;
            ring.push({ x: m.x + u.x * ra * Math.cos(t) + n.x * rb * Math.sin(t), y: m.y + u.y * ra * Math.cos(t) + n.y * rb * Math.sin(t) });
          }
          s.paths.push({ pts: ring, width: 2 });
          s.handles = [a, b, { x: m.x + n.x * rb, y: m.y + n.y * rb }, { x: m.x - n.x * rb, y: m.y - n.y * rb }];
        }
        s.polys.push({ pts: ring, alpha: 0.2 });
        s.hitArea = ring;
        break;
      }
      case "arc":
      case "curve":
      case "doublecurve": {
        // Arc: a parabola from point 1 to point 2 through point 3, filled down to the chord. Curve:
        // point 3 is the bend's control point. Double curve: points 3 and 4 are the two control
        // points of a cubic curve.
        const need = d.type === "doublecurve" ? 4 : 3;
        if (pts.length < need) {
          L(a, b, { width: 2 });
          if (d.type === "doublecurve" && c) L(b, c, { dash: [3, 3], width: 1, alpha: 0.6 });
          break;
        }
        const k1 = d.type === "arc" ? { x: 2 * c.x - (a.x + b.x) / 2, y: 2 * c.y - (a.y + b.y) / 2 } : c,
          k2 = pts[3],
          curve = [];
        for (let i = 0; i <= 60; i++) {
          const t = i / 60, u = 1 - t;
          curve.push(
            d.type === "doublecurve"
              ? { x: u * u * u * a.x + 3 * u * u * t * k1.x + 3 * u * t * t * k2.x + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * k1.y + 3 * u * t * t * k2.y + t * t * t * b.y }
              : { x: u * u * a.x + 2 * u * t * k1.x + t * t * b.x, y: u * u * a.y + 2 * u * t * k1.y + t * t * b.y },
          );
        }
        s.paths.push({ pts: curve, width: 2 });
        if (d.type === "arc") {
          s.polys.push({ pts: curve, alpha: 0.2 });
          s.hitArea = curve;
        }
        break;
      }
      case "text": {
        // Bare text with its top-left at the click; a background or border only once one is set.
        const st = d.style || {}, fs = st.fontSize || 14, editing = this.editing === d;
        const txt = d.text || (active || editing ? "Add text" : "");
        if (!txt) break;
        const blk = block(txt, fs, st.bold), boxed = st.fill || d.color, pad = boxed ? 6 : 2;
        if (boxed) s.boxes.push({ x: a.x - pad, y: a.y - pad / 2, w: blk.w + 2 * pad, h: blk.h + pad, r: 3, fill: st.fill, fillAlpha: st.fillAlpha ?? 0.25, stroke: d.color });
        putText(blk, a.x, a.y, st.textColor || TYPE_COLOR.text, { placeholder: !d.text, hidden: editing });
        s.hitArea = rect(a.x - pad, a.y - pad / 2, blk.w + 2 * pad, blk.h + pad);
        break;
      }
      case "note":
      case "pricenote": {
        // A leader from a dot at point 1 to a label box; point 2 is the middle of the box edge
        // facing point 1. A price note shows point 1's price (plus any text).
        const pn = d.type === "pricenote", st = d.style || {}, fs = st.fontSize || (pn ? 12 : 14), editing = this.editing === d,
          target = b || a,
          txt = pn ? [price(a.price), editing ? "" : d.text].filter(Boolean).join(" ") : d.text || "Add text",
          blk = block(txt, fs),
          w = blk.w + 18, h = blk.h + 9,
          dx = target.x - a.x, dy = target.y - a.y;
        const bx = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? target.x : target.x - w) : target.x - w / 2,
          by = Math.abs(dx) >= Math.abs(dy) ? target.y - h / 2 : dy >= 0 ? target.y : target.y - h;
        if (b) L(a, target, { width: 1 });
        s.boxes.push({ x: a.x - 3, y: a.y - 3, w: 6, h: 6, r: 3, fill: colorOf(d) });
        s.boxes.push({ x: bx, y: by, w, h, r: 4, fill: st.fill || (pn ? colorOf(d) : "#ffffff"), fillAlpha: st.fillAlpha ?? 1, stroke: pn ? colorOf(d) : null, shadow: !pn });
        putText(blk, bx + 9, by + 4.5, st.textColor || (pn ? "#ffffff" : "#0f0f0f"), { placeholder: !pn && !d.text, hidden: editing && !pn });
        if (pn && editing) s.editAt = { x: bx + 9 + measure(blk.f, price(a.price)) + 6, y: by + 4.5 + blk.lh / 2, align: "left", fs, color: st.textColor || "#ffffff" };
        s.hitArea = rect(bx, by, w, h);
        s.handles = [a, target];
        break;
      }
      case "pin": {
        // A map pin with its tip on the point; its text shows in a bubble above while selected.
        const st = d.style || {}, col = colorOf(d), cy = a.y - 17, drop = [];
        for (let i = 0; i <= 24; i++) {
          const t = Math.PI * 0.75 + (Math.PI * 1.5 * i) / 24;
          drop.push({ x: a.x + 8.5 * Math.cos(t), y: cy + 8.5 * Math.sin(t) });
        }
        drop.push({ x: a.x, y: a.y });
        s.polys.push({ pts: drop, color: col, alpha: 1 });
        s.boxes.push({ x: a.x - 3, y: cy - 3, w: 6, h: 6, r: 3, fill: "#ffffff" });
        s.hitArea = drop;
        if (active || this.editing === d) {
          const fs = st.fontSize || 14, blk = block(d.text || "Add text", fs),
            w = Math.max(120, blk.w + 28), h = blk.h + 16, bx = a.x - w / 2, by = cy - 12 - 10 - h;
          s.polys.push({ pts: [{ x: a.x - 7, y: by + h }, { x: a.x + 7, y: by + h }, { x: a.x, y: by + h + 10 }], color: st.fill || col, alpha: st.fillAlpha ?? 0.85 });
          s.boxes.push({ x: bx, y: by, w, h, r: 6, fill: st.fill || col, fillAlpha: st.fillAlpha ?? 0.85, shadow: true });
          putText(blk, bx + 14, by + 8, st.textColor || "#ffffff", { placeholder: !d.text, hidden: this.editing === d });
          s.hitArea = [...rect(bx, by, w, h + 10)];
          s.hitArea = drop.concat([]);
        }
        s.handles = [a];
        break;
      }
      case "table": {
        // A grid of cells (3 by 3 to start) with its top-left at the click; double-click a cell to
        // type in it. Cells keep their size on screen.
        const st = d.style || {}, t = d.table || { rows: 3, cols: 3, cells: [] }, cw = 119, ch = 31, fs = st.fontSize || 14,
          W = t.cols * cw, H = t.rows * ch, tc = st.textColor || themeColor("--text", "#d1d4dc");
        if (st.fill) s.boxes.push({ x: a.x, y: a.y, w: W, h: H, r: 0, fill: st.fill, fillAlpha: st.fillAlpha ?? 0.2 });
        for (let r = 0; r <= t.rows; r++) L({ x: a.x, y: a.y + r * ch }, { x: a.x + W, y: a.y + r * ch }, { width: 1 });
        for (let c = 0; c <= t.cols; c++) L({ x: a.x + c * cw, y: a.y }, { x: a.x + c * cw, y: a.y + H }, { width: 1 });
        const f = font(fs);
        for (let r = 0; r < t.rows; r++)
          for (let c = 0; c < t.cols; c++) {
            const v = t.cells?.[r]?.[c];
            if (!v || (this.editingCell?.d === d && this.editingCell.r === r && this.editingCell.c === c)) continue;
            s.texts.push({ text: fit(f, String(v).split("\n")[0], cw - 18), x: a.x + c * cw + 9, y: a.y + r * ch + ch / 2, color: tc, font: f });
          }
        s.table = { x0: a.x, y0: a.y, cw, ch, rows: t.rows, cols: t.cols, fs, color: tc };
        s.hitArea = rect(a.x, a.y, W, H);
        s.handles = [a, { x: a.x + W, y: a.y }, { x: a.x, y: a.y + H }, { x: a.x + W, y: a.y + H }];
        break;
      }
      case "callout": {
        // A box centred on point 2 with a wedge from its edge to point 1, the tip.
        const st = d.style || {}, fs = st.fontSize || 14, editing = this.editing === d, target = b || a,
          blk = block(d.text || "Add text", fs), w = blk.w + 20, h = blk.h + 12, bx = target.x - w / 2, by = target.y - h / 2;
        const box = rect(bx, by, w, h), dx = a.x - target.x, dy = a.y - target.y;
        let shape = box;
        if (b && !(a.x > bx && a.x < bx + w && a.y > by && a.y < by + h)) {
          const side = Math.abs(dx) * h >= Math.abs(dy) * w ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
          const [p, q] = [box[side], box[(side + 1) % 4]], horiz = side % 2 === 0, len = horiz ? Math.abs(q.x - p.x) : Math.abs(q.y - p.y),
            base = Math.min(len * 0.4, 30), along = horiz ? a.x : a.y, lo = Math.min(horiz ? p.x : p.y, horiz ? q.x : q.y) + base / 2,
            hi = Math.max(horiz ? p.x : p.y, horiz ? q.x : q.y) - base / 2, mid0 = Math.max(lo, Math.min(hi, along)),
            dir = Math.sign(horiz ? q.x - p.x : q.y - p.y),
            w1 = horiz ? { x: mid0 - (dir * base) / 2, y: p.y } : { x: p.x, y: mid0 - (dir * base) / 2 },
            w2 = horiz ? { x: mid0 + (dir * base) / 2, y: p.y } : { x: p.x, y: mid0 + (dir * base) / 2 };
          shape = [...box.slice(0, side + 1), w1, { x: a.x, y: a.y }, w2, ...box.slice(side + 1)];
        }
        s.polys.push({ pts: shape, alpha: st.fillAlpha ?? 0.7, stroke: true, strokeWidth: 2 });
        putText(blk, bx + 10, by + 6, st.textColor || "#ffffff", { placeholder: !d.text, hidden: editing });
        s.hitArea = shape;
        s.handles = [a, target];
        break;
      }
      case "comment": {
        // A speech bubble growing up and right from the click (its square corner).
        const st = d.style || {}, fs = st.fontSize || 16, editing = this.editing === d,
          blk = block(d.text || "Add text", fs), w = blk.w + 26, h = blk.h + 22, bx = a.x, by = a.y - h;
        s.boxes.push({ x: bx, y: by, w, h, radii: [h / 2, h / 2, h / 2, 0], fill: st.fill || colorOf(d), fillAlpha: st.fillAlpha ?? 1 });
        putText(blk, bx + 13, by + 11, st.textColor || "#ffffff", { placeholder: !d.text, hidden: editing });
        s.hitArea = rect(bx, by, w, h);
        s.handles = [a];
        break;
      }
      case "pricelabel": {
        // The price at the click, in a tag up and to the right with a tail down to the point.
        const st = d.style || {}, blk = block(price(a.price), 14, true), w = blk.w + 16, h = blk.h + 8, bx = a.x + 10, by = a.y - 14 - h,
          fillc = st.fill || colorOf(d);
        s.polys.push({ pts: [{ x: bx, y: by + h - 6 }, { x: bx + 12, y: by + h }, { x: a.x, y: a.y }], color: fillc, alpha: st.fillAlpha ?? 1 });
        s.boxes.push({ x: bx, y: by, w, h, r: 3, fill: fillc, fillAlpha: st.fillAlpha ?? 1, stroke: colorOf(d) });
        putText(blk, bx + 8, by + 4, st.textColor || "#ffffff", {});
        s.hitArea = [{ x: bx, y: by }, { x: bx + w, y: by }, { x: bx + w, y: by + h }, { x: bx + 12, y: by + h }, { x: a.x, y: a.y }, { x: bx, y: by + h - 6 }];
        s.handles = [a];
        break;
      }
      case "signpost": {
        // A pole straight up (or down) from the point to a plate with text; point 2 sets the height.
        const st = d.style || {}, fs = st.fontSize || 12, editing = this.editing === d, target = b || a,
          up = target.y <= a.y, blk = block(d.text || "Add text", fs), w = blk.w + 16, h = blk.h + 10,
          top = { x: a.x, y: target.y }, bx = a.x - w / 2, by = up ? top.y - h : top.y;
        L(a, top, { width: 1 });
        s.boxes.push({ x: bx, y: by, w, h, r: 4, fill: st.fill || "#ffffff", fillAlpha: st.fillAlpha ?? 1, stroke: "rgba(0,0,0,0.18)" });
        putText(blk, bx + 8, by + 5, st.textColor || "#0f0f0f", { placeholder: !d.text, hidden: editing });
        s.hitArea = rect(bx, by, w, h);
        s.handles = [a, top];
        break;
      }
      case "flagmark": {
        // A small flag on a pole standing on the point.
        const col = colorOf(d), flag = [{ x: a.x, y: a.y - 20 }, { x: a.x + 17, y: a.y - 20 }, { x: a.x + 14, y: a.y - 15 }, { x: a.x + 17, y: a.y - 10 }, { x: a.x, y: a.y - 10 }];
        L(a, { x: a.x, y: a.y - 20 }, { color: GRAY, width: 1.5 });
        s.polys.push({ pts: flag, color: col, alpha: 1 });
        s.hitArea = [{ x: a.x - 3, y: a.y }, ...flag.slice(0, 4), { x: a.x - 3, y: a.y - 20 }];
        s.handles = [a];
        break;
      }
      case "image": {
        // A picture with its top-left at the click, kept at its size on screen. Double-click to
        // choose or replace it.
        const sz = d.imgSize || { w: 220, h: 130 };
        if (d.image) s.images.push({ src: d.image, x: a.x, y: a.y, w: sz.w, h: sz.h, alpha: d.style?.fillAlpha ?? 1 });
        else {
          L({ x: a.x, y: a.y }, { x: a.x + sz.w, y: a.y }, { dash: [4, 4], width: 1 });
          L({ x: a.x + sz.w, y: a.y }, { x: a.x + sz.w, y: a.y + sz.h }, { dash: [4, 4], width: 1 });
          L({ x: a.x + sz.w, y: a.y + sz.h }, { x: a.x, y: a.y + sz.h }, { dash: [4, 4], width: 1 });
          L({ x: a.x, y: a.y + sz.h }, { x: a.x, y: a.y }, { dash: [4, 4], width: 1 });
          s.texts.push({ text: "Double-click to choose an image", x: a.x + sz.w / 2, y: a.y + sz.h / 2, align: "center", color: themeColor("--muted", "#787b86"), font: font(12) });
        }
        s.hitArea = rect(a.x, a.y, sz.w, sz.h);
        s.handles = [a, { x: a.x + sz.w, y: a.y }, { x: a.x, y: a.y + sz.h }, { x: a.x + sz.w, y: a.y + sz.h }];
        break;
      }
      case "post":
      case "idea": {
        // A card for an X post or a TradingView idea, joined to its bar by an elbow line.
        // Post: @handle, your text, "Link to X post", and the date (from the post's id).
        const post = d.type === "post", W = 280, pad = 12, rows = [],
          dark = "#0f0f0f", grey = "#6a6d78";
        const link = parseLink(d.url);
        if (post) {
          rows.push([link.handle ? `@${link.handle}` : "X post", font(14, true), dark]);
          for (const ln of wrap(font(13), d.text || (d.url ? "" : "Double-click to add a link"), W - 2 * pad).slice(0, 6)) rows.push([ln, font(13), d.url ? dark : grey]);
          if (d.url) rows.push(["Link to X post", font(13), BLUE]);
        } else {
          for (const ln of wrap(font(14, true), d.text || (d.url ? "TradingView idea" : "Double-click to add a link"), W - 2 * pad).slice(0, 3)) rows.push([ln, font(14, true), dark]);
          if (link.host) rows.push([link.host, font(12), grey]);
        }
        rows.push(["div"], [cardDate(post && link.time ? link.time : a.time), font(12), grey]);
        const H = rows.reduce((t, r) => t + (r[0] === "div" ? 9 : 19), 0) + 2 * pad - 2,
          bx = a.x + 24, by = a.y - 28 - H, elbow = bx + 20;
        L(a, { x: a.x, y: a.y - 14 }, { color: GRAY, width: 1 });
        L({ x: a.x, y: a.y - 14 }, { x: elbow, y: a.y - 14 }, { color: GRAY, width: 1 });
        L({ x: elbow, y: a.y - 14 }, { x: elbow, y: a.y - 28 }, { color: GRAY, width: 1 });
        s.boxes.push({ x: bx, y: by, w: W, h: H, r: 8, fill: "#ffffff", stroke: "rgba(0,0,0,0.12)", shadow: true });
        let y = by + pad;
        for (const [t, f, col] of rows) {
          if (t === "div") {
            L({ x: bx + pad, y: y + 4 }, { x: bx + W - pad, y: y + 4 }, { color: "rgba(0,0,0,0.12)", width: 1 });
            y += 9;
            continue;
          }
          s.texts.push({ text: t, x: bx + pad, y: y + 9, color: col, font: f });
          y += 19;
        }
        s.hitArea = rect(bx, by, W, H);
        s.handles = [a];
        break;
      }
      case "emoji":
      case "sticker":
      case "icon": {
        // Centred on the click, at the size chosen in the toolbar (40 pixels to start).
        const sz = d.style?.size || 40;
        if (d.type === "emoji") s.texts.push({ text: d.text || "🙂", x: a.x, y: a.y + sz * 0.06, align: "center", color: "#000", font: `${sz}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif` });
        else if (d.type === "icon") {
          const ic = ICON_BY_ID[d.text] || ICON_BY_ID.star;
          if (ic.path) s.icons.push({ path: ic.path, x: a.x - sz / 2, y: a.y - sz / 2, size: sz });
          else s.texts.push({ text: ic.text, x: a.x, y: a.y, align: "center", font: font(sz * 0.85, true) });
        } else {
          // a sticker: a bold badge with a white edge, like a printed sticker
          const stk = STICKER_BY_ID[d.text] || STICKER_BY_ID.buy, fs = sz * 0.42, blk = block(stk.text, fs, true),
            w = blk.w + fs * 1.3, h = fs * 1.9, bx = a.x - w / 2, by = a.y - h / 2;
          s.boxes.push({ x: bx - 3, y: by - 3, w: w + 6, h: h + 6, r: h / 2 + 3, fill: "#ffffff", shadow: true });
          s.boxes.push({ x: bx, y: by, w, h, r: h / 2, fill: stk.color });
          s.texts.push({ text: stk.text, x: a.x, y: a.y + 0.5, align: "center", color: "#ffffff", font: blk.f });
          s.hitArea = rect(bx - 3, by - 3, w + 6, h + 6);
          s.handles = [{ x: bx, y: by }, { x: bx + w, y: by }, { x: bx, y: by + h }, { x: bx + w, y: by + h }];
          break;
        }
        s.hitArea = rect(a.x - sz / 2, a.y - sz / 2, sz, sz);
        s.handles = [{ x: a.x - sz / 2, y: a.y - sz / 2 }, { x: a.x + sz / 2, y: a.y - sz / 2 }, { x: a.x - sz / 2, y: a.y + sz / 2 }, { x: a.x + sz / 2, y: a.y + sz / 2 }];
        break;
      }
      default:
        return null;
    }
    return s;
  }

  paintShape(ctx, s, color, size, st = {}) {
    ctx.save();
    const width = ctx.lineWidth;
    for (const p of s.polys) {
      if (p.gradient) {
        const xs = p.pts.map((q) => q.x),
          g = ctx.createLinearGradient(Math.min(...xs), 0, Math.max(...xs), 0);
        g.addColorStop(0, p.gradient[0]);
        g.addColorStop(1, p.gradient[1]);
        ctx.fillStyle = g;
      } else ctx.fillStyle = p.color || st.fill || color;
      ctx.globalAlpha = !p.color && !p.gradient && st.fillAlpha != null ? st.fillAlpha : p.alpha ?? 1;
      ctx.beginPath();
      p.pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      if (p.hole) {
        p.hole.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.closePath();
      }
      ctx.fill(p.hole ? "evenodd" : "nonzero");
      if (p.stroke) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = p.stroke === true ? color : p.stroke;
        ctx.lineWidth = p.strokeWidth || 1;
        ctx.setLineDash([]);
        ctx.stroke();
      }
    }
    for (const l of [...s.lines, ...s.paths]) {
      const main = !l.color && !l.dash?.length;
      ctx.strokeStyle = l.color || color;
      ctx.lineWidth = main && st.width ? st.width : l.width || width;
      ctx.globalAlpha = l.alpha ?? 1;
      ctx.setLineDash(main && st.dash ? dashOf(st.dash, ctx.lineWidth) : l.dash || []);
      ctx.lineCap = ctx.lineJoin = l.cap || "butt";
      if (ctx.lineJoin === "butt") ctx.lineJoin = "miter";
      if (l.pts) {
        ctx.beginPath();
        l.pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.stroke();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(l.a.x, l.a.y);
      ctx.lineTo(l.b.x, l.b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const bx of s.boxes) {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx.x, bx.y, bx.w, bx.h, bx.radii || bx.r || 0);
      else ctx.rect(bx.x, bx.y, bx.w, bx.h);
      if (bx.fill) {
        if (bx.shadow) {
          ctx.shadowColor = "rgba(0,0,0,0.3)";
          ctx.shadowBlur = 6;
          ctx.shadowOffsetY = 2;
        }
        ctx.globalAlpha = bx.fillAlpha ?? 1;
        ctx.fillStyle = bx.fill;
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = ctx.shadowOffsetY = 0;
      }
      if (bx.stroke) {
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
        ctx.strokeStyle = bx.stroke;
        ctx.stroke();
      }
    }
    for (const ic of s.icons) {
      ctx.save();
      ctx.translate(ic.x, ic.y);
      ctx.scale(ic.size / 24, ic.size / 24);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.setLineDash([]);
      ctx.stroke(new Path2D(ic.path));
      ctx.restore();
    }
    for (const im of s.images) {
      let img = images.get(im.src);
      if (!img) {
        img = new Image();
        img.onload = () => this.update();
        img.src = im.src;
        images.set(im.src, img);
      }
      if (img.complete && img.naturalWidth) {
        ctx.globalAlpha = im.alpha ?? 1;
        ctx.drawImage(img, im.x, im.y, im.w, im.h);
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    for (const r of s.arcs) {
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, r.to, r.to < 0);
      ctx.stroke();
    }
    ctx.textBaseline = "middle";
    for (const t of s.texts) {
      if (t.bg && !t.box) {
        ctx.font = t.font || SMALL;
        const w = ctx.measureText(t.text).width + 10,
          x = t.align === "center" ? t.x - w / 2 : t.align === "right" ? t.x - w : t.x;
        ctx.fillStyle = t.bg === true ? color : t.bg;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, t.y - 9, w, 18, 3);
        else ctx.rect(x, t.y - 9, w, 18);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.textAlign = "left";
        ctx.fillText(t.text, x + 5, t.y);
        continue;
      }
      if (!t.box) {
        ctx.fillStyle = t.color || color;
        ctx.globalAlpha = t.alpha ?? 1;
        ctx.font = t.font || SMALL;
        ctx.textAlign = t.align || "left";
        ctx.fillText(t.text, t.x, t.y);
        continue;
      }
      ctx.font = "12px -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.textAlign = "left";
      const w = Math.max(...t.box.map((x) => ctx.measureText(x).width)) + 16,
        h = t.box.length * 17 + 8,
        gap = t.gap ?? 8,
        y0 = t.place === "above" ? t.y - h - gap : t.place === "below" ? t.y + gap : t.place === "middle" ? t.y - h / 2 : t.y,
        x = Math.max(4, Math.min(t.center ? t.x - w / 2 : t.x, size.width - w - 4)),
        y = Math.max(4, Math.min(y0, size.height - h - 4));
      ctx.fillStyle = t.bg || color;
      ctx.globalAlpha = t.bg ? 1 : 0.9;
      if (t.shadow) {
        ctx.shadowColor = "rgba(0,0,0,0.35)";
        ctx.shadowBlur = 6;
      }
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, 4);
      else ctx.rect(x, y, w, h);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
      ctx.globalAlpha = 1;
      ctx.fillStyle = t.fg || "#fff";
      if (t.align === "center") ctx.textAlign = "center";
      t.box.forEach((line, i) => ctx.fillText(line, t.align === "center" ? x + w / 2 : x + 8, y + 4 + 17 * i + 8.5));
      ctx.fillStyle = color;
    }
    ctx.restore();
  }

  tickSize() {
    const sym = this.pane.cfg?.symbol;
    if (this._tick?.sym === sym) return this._tick.v;
    let dec = 2;
    if (!String(sym).startsWith("US:"))
      for (const b of (this.pane.shown || []).slice(-40))
        for (const v of [b.open, b.high, b.low, b.close]) {
          const t = String(v), i = t.indexOf(".");
          if (i >= 0 && !/e/i.test(t)) dec = Math.max(dec, Math.min(8, t.length - i - 1));
        }
    this._tick = { sym, v: 10 ** -dec };
    return this._tick.v;
  }

  // Nearest drawing within a few pixels of (x, y), for selecting.
  hitTest(x, y) {
    let best = null,
      bestD = 7;
    const segDist = (p, q) => {
      const dx = q.x - p.x,
        dy = q.y - p.y,
        l2 = dx * dx + dy * dy;
      const t = l2
        ? Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / l2))
        : 0;
      return Math.hypot(x - (p.x + t * dx), y - (p.y + t * dy));
    };
    for (const d of this.items) {
      if (!this.shows(d)) continue;
      const pts = d.points.map((p) => ({
        x: this.x(p.time),
        y: this.y(p.price),
        ...p,
      }));
      if (pts.some((p) => p.x == null || p.y == null)) continue;
      const [a, b] = pts;
      let dist = Infinity;
      if (SHAPED.has(d.type)) {
        const s = this.shapeOf(d, pts, this._size || { width: 1e5, height: 1e5 });
        const segs = s ? [...s.lines.map((l) => [l.a, l.b]), ...s.paths.flatMap((p) => p.pts.slice(1).map((q, i) => [p.pts[i], q]))] : [];
        dist = s?.hitArea && inside(x, y, s.hitArea) ? 0 : Math.min(...segs.map(([p, q]) => segDist(p, q)));
      } else if (d.type === "hline") dist = Math.abs(y - a.y);
      else if (d.type === "hray")
        dist = x >= a.x - 4 ? Math.abs(y - a.y) : Infinity;
      else if (d.type === "vline") dist = Math.abs(x - a.x);
      else if (b) {
        const far = (p, q, both) => {
          const dx = q.x - p.x,
            dy = q.y - p.y,
            len = Math.hypot(dx, dy) || 1;
          return [
            both ? { x: p.x - (dx / len) * 1e5, y: p.y - (dy / len) * 1e5 } : p,
            { x: p.x + (dx / len) * 1e5, y: p.y + (dy / len) * 1e5 },
          ];
        };
        const [p, q] =
          d.type === "ray"
            ? far(a, b, false)
            : d.type === "extended"
              ? far(a, b, true)
              : [a, b];
        dist = segDist(p, q);
      }
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    return best;
  }
}
