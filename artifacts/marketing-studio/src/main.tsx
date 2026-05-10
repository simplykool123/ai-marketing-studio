import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
// Curated display/text fonts for artwork editor
import "@fontsource/playfair-display/400.css";
import "@fontsource/playfair-display/700.css";
import "@fontsource/lora/400.css";
import "@fontsource/lora/700.css";
import "@fontsource/merriweather/400.css";
import "@fontsource/merriweather/700.css";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/700.css";
import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/700.css";
import "@fontsource/bebas-neue/400.css";
import { installApiAuthFetch } from "@/lib/api-auth-fetch";

installApiAuthFetch();

createRoot(document.getElementById("root")!).render(<App />);
