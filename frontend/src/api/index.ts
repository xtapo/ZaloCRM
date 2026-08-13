import axios from 'axios';
import { router } from '@/router/index';

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
  withCredentials: true,
  headers: {
    'X-Requested-With': 'XMLHttpRequest',
  },
});

// Response interceptor — handle 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // fire-and-forget logout to clear cookie
      axios.post('/api/v1/auth/logout', {}, { withCredentials: true }).catch(() => {});
      // Use Vue Router instead of hard reload to prevent redirect loops
      const currentPath = router.currentRoute.value.path;
      if (currentPath !== '/login' && currentPath !== '/setup') {
        router.replace('/login');
      }
    }
    return Promise.reject(error);
  },
);

export { api };
