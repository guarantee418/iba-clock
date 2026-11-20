import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Published on GitHub Pages at https://time.ibakings.org/ (public/CNAME)
export default defineConfig({ base: '/', plugins: [react()], server: { port: 5175, strictPort: true } });
