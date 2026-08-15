import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router/index';
import { vuetify } from './plugins/vuetify';
// Thứ tự nạp CSS rất quan trọng:
// 1. style.css  — design token gốc (--smax-*, --radius-*, --shadow-*) + utility
//    class (.soft-card, .soft-icon-btn, .soft-segment, .soft-table, .chip-*).
//    Trước đây file này KHÔNG được import ở đâu cả → mọi token/class mới
//    không tồn tại lúc runtime, giao diện rơi về giá trị cũ của tokens.css.
// 2. tokens.css — chỉ còn token riêng (chip label CRM, typography, bubble...).
// 3. main.css / rbac-page.css — override component, phải nạp sau token.
import './style.css';
import './assets/tokens.css';
import './assets/main.css';
import './assets/rbac-page.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(vuetify);
app.mount('#app');

// TODO: Re-enable PWA when vite-plugin-pwa supports vite 8
// if ('serviceWorker' in navigator) {
//   import('virtual:pwa-register').then(({ registerSW }) => {
//     registerSW({ immediate: true });
//   });
// }
