import { defineConfig } from 'vite';

// base: './' => relativní cesty, takže build funguje na GitHub Pages
// v podadresáři (https://uzivatel.github.io/repo/) i jinde.
// @zxing/library se načítá dynamicky, takže si ho bundler rozdělí sám
// a na Androidu (nativní BarcodeDetector) se vůbec nestahuje.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 2048,
  },
  server: {
    host: true,
    port: 5173,
  },
});
