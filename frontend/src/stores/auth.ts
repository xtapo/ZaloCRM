import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api } from '@/api/index';
import { refreshOrgTimezone } from '@/composables/use-org-timezone';

interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
  orgId: string;
  orgName: string;
  orgTimezone?: string;
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const needsSetup = ref(false);

  const isAuthenticated = computed(() => !!user.value);
  const isOwner = computed(() => user.value?.role === 'owner');
  const isAdmin = computed(() => ['owner', 'admin'].includes(user.value?.role || ''));

  async function checkSetup() {
    const res = await api.get('/setup/status');
    needsSetup.value = res.data.needsSetup;
    return res.data.needsSetup;
  }

  async function setup(data: { orgName: string; fullName: string; email: string; password: string }) {
    const res = await api.post('/setup', data);
    user.value = res.data.user;
  }

  async function login(email: string, password: string) {
    const res = await api.post('/auth/login', { email, password });
    user.value = res.data.user;
  }

  async function fetchProfile() {
    try {
      const res = await api.get('/profile');
      const data = res.data;
      const tz = data.org?.timezone ?? '+07:00';
      user.value = {
        id: data.id,
        email: data.email,
        fullName: data.fullName,
        role: data.role,
        orgId: data.orgId,
        orgName: data.org?.name ?? '',
        orgTimezone: tz,
      };
      refreshOrgTimezone(tz);
    } catch {
      logout();
    }
  }

  function logout() {
    user.value = null;
    api.post('/auth/logout').catch(() => {});
  }

  async function init() {
    await fetchProfile();
  }

  return { user, needsSetup, isAuthenticated, isOwner, isAdmin, checkSetup, setup, login, fetchProfile, logout, init };
});
