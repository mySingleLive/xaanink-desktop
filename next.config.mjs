/** @type {import('next').NextConfig} */
const config = { output: "export", images: { unoptimized: true }, turbopack: { root: import.meta.dirname }, poweredByHeader: false }
export default config
