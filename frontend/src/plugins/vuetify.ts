import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';

/**
 * Vuetify theme — palette "soft green" theo mockup dashboard tham khảo:
 * nền xám nhạt, card trắng bo tròn lớn, accent xanh lá đậm.
 *
 * Tên theme `smax-light` được giữ nguyên để không phá vỡ giá trị đã lưu trong
 * localStorage('theme') và các view đang tham chiếu. `legacy-dark` vẫn giữ để
 * fallback.
 */
export const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: localStorage.getItem('theme') || 'smax-light',
    themes: {
      'smax-light': {
        dark: false,
        colors: {
          background: '#eceef0',
          surface: '#ffffff',
          'surface-variant': '#f6f8f7',
          primary: '#16a34a',
          secondary: '#0f2f21',
          accent: '#22c55e',
          error: '#ef4444',
          warning: '#f59e0b',
          success: '#16a34a',
          info: '#0ea5e9',
          'on-background': '#111827',
          'on-surface': '#111827',
          'on-primary': '#ffffff',
          'on-secondary': '#ffffff',
        },
      },
      'legacy-dark': {
        dark: true,
        colors: {
          background: '#0b1a12',
          surface: '#12241a',
          'surface-variant': '#17301f',
          primary: '#22c55e',
          secondary: '#e6f4ec',
          accent: '#22c55e',
          error: '#ff5252',
          warning: '#ffb74d',
          success: '#4caf50',
          info: '#38bdf8',
          'on-background': '#e6f4ec',
          'on-surface': '#e6f4ec',
          'on-primary': '#06170e',
        },
      },
    },
  },
  defaults: {
    VBtn: { variant: 'flat', rounded: 'pill', class: 'text-none' },
    VTextField: { variant: 'solo-filled', flat: true, density: 'comfortable', rounded: 'lg', hideDetails: 'auto' },
    VSelect: { variant: 'solo-filled', flat: true, density: 'comfortable', rounded: 'lg', hideDetails: 'auto' },
    VAutocomplete: { variant: 'solo-filled', flat: true, density: 'comfortable', rounded: 'lg', hideDetails: 'auto' },
    VTextarea: { variant: 'solo-filled', flat: true, density: 'comfortable', rounded: 'lg', hideDetails: 'auto' },
    VCard: { rounded: 'xl', variant: 'flat', class: 'soft-card' },
    VSheet: { rounded: 'xl' },
    VChip: { rounded: 'pill', size: 'small' },
    VDialog: { maxWidth: 600 },
    VDataTable: { hover: true },
  },
});
