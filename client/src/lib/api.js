import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(config => {
  const token = localStorage.getItem('pm_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res,
  err => {
    const onAuthPage = window.location.pathname === '/login' || window.location.pathname === '/reset-password' || window.location.pathname.startsWith('/sign/');
    if (err.response?.status === 401 && !onAuthPage) {
      localStorage.removeItem('pm_token');
      localStorage.removeItem('pm_login_at');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
