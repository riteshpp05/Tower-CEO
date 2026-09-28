/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: {
          50:  "#FBF7F2",
          100: "#F5EEE3",
          200: "#EDE3D6",
          300: "#E2D4C2",
          400: "#CDBBA3",
          500: "#B39F84",
        },
        terra: {
          50:  "#FBEDE6",
          100: "#F5D2C0",
          200: "#E9AC8C",
          300: "#DB865E",
          400: "#CE7148",
          500: "#C1603D",
          600: "#A34F31",
          700: "#833F27",
          800: "#63301E",
          900: "#432116",
        },
        ink: {
          300: "#8A7A68",
          400: "#6E6152",
          500: "#574C3F",
          600: "#453C31",
          700: "#3A2E22",
          800: "#2E241A",
          900: "#221B13",
        },
      },
    },
  },
  plugins: [],
};