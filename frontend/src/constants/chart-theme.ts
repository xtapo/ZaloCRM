/**
 * Palette & options dùng chung cho mọi biểu đồ Chart.js trong ZaloCRM.
 *
 * Mục đích: tránh mỗi component tự hard-code màu (trước đây có #1565C0,
 * #42A5F5, #1877F2, #00F2FF... lẫn lộn) — tất cả giờ lấy từ 1 nguồn theo
 * design system "soft green".
 */

/** Màu thương hiệu — khớp tokens trong style.css / vuetify.ts */
export const BRAND = {
  green: '#16a34a',
  greenDark: '#15803d',
  greenDeep: '#0f6b34',
  greenSoft: '#86efac',
  greenTint: '#dcfce7',
  amber: '#f59e0b',
  orange: '#f97316',
  sky: '#0ea5e9',
  violet: '#8b5cf6',
  red: '#ef4444',
  grey: '#9ca3af',
  greyLight: '#d1d5db',
  text: '#111827',
  textMuted: '#6b7280',
  gridLine: 'rgba(17, 24, 39, 0.06)',
} as const;

/** Dãy màu mặc định cho chuỗi dữ liệu (xanh lá làm chủ đạo). */
export const CHART_SERIES: string[] = [
  BRAND.green,
  BRAND.greenSoft,
  BRAND.greenDeep,
  BRAND.amber,
  BRAND.sky,
  BRAND.violet,
  BRAND.orange,
  BRAND.grey,
];

/** Màu theo trạng thái pipeline khách hàng. */
export const PIPELINE_COLORS: Record<string, string> = {
  new: BRAND.greyLight,
  contacted: BRAND.greenSoft,
  interested: BRAND.amber,
  converted: BRAND.green,
  lost: BRAND.red,
};

/** Màu theo trạng thái lịch hẹn. */
export const APPOINTMENT_COLORS: Record<string, string> = {
  scheduled: BRAND.greenSoft,
  completed: BRAND.green,
  cancelled: BRAND.greyLight,
  no_show: BRAND.red,
};

/** Màu theo nguồn khách hàng. */
export const SOURCE_COLORS: Record<string, string> = {
  FB: BRAND.green,
  TT: BRAND.greenDeep,
  GT: BRAND.amber,
  CN: BRAND.greenSoft,
};

/** Lấy màu theo index, tự vòng lại khi hết dãy. */
export function seriesColor(index: number): string {
  return CHART_SERIES[index % CHART_SERIES.length];
}

/** Legend dạng pill nhỏ, chữ xám — giống mockup. */
const legend = (position: 'top' | 'right' | 'bottom') => ({
  position,
  labels: {
    boxWidth: 10,
    boxHeight: 10,
    usePointStyle: true,
    pointStyle: 'circle' as const,
    padding: 16,
    color: BRAND.textMuted,
    font: { size: 12, family: 'Inter, sans-serif' },
  },
});

const tooltip = {
  backgroundColor: '#ffffff',
  titleColor: BRAND.text,
  bodyColor: BRAND.textMuted,
  borderColor: BRAND.gridLine,
  borderWidth: 1,
  padding: 12,
  cornerRadius: 12,
  displayColors: true,
  boxPadding: 4,
};

/** Options cho bar chart: cột bo tròn, chỉ kẻ ngang mờ. */
export const barChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  borderRadius: 10,
  plugins: { legend: legend('top'), tooltip },
  scales: {
    x: {
      grid: { display: false },
      border: { display: false },
      ticks: { color: BRAND.textMuted, font: { size: 11 } },
    },
    y: {
      beginAtZero: true,
      grid: { color: BRAND.gridLine },
      border: { display: false },
      ticks: { color: BRAND.textMuted, font: { size: 11 } },
    },
  },
};

/** Options cho pie/doughnut: legend bên phải, viền trắng tách miếng. */
export const pieChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '62%',
  plugins: { legend: legend('right'), tooltip },
  elements: {
    arc: { borderWidth: 3, borderColor: '#ffffff' },
  },
};
