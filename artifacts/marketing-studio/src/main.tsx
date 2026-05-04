import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installApiAuthFetch } from "@/lib/api-auth-fetch";

installApiAuthFetch();

createRoot(document.getElementById("root")!).render(<App />);
