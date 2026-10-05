import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

const base = (d: string) =>
  function Icon({ size = 16, ...props }: P & { size?: number }) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
        dangerouslySetInnerHTML={{ __html: d }}
      />
    );
  };

export const IconDashboard = base('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>');
export const IconClients = base('<path d="M3 21V8l6-4 6 4v13"/><path d="M15 21V11l6 3v7"/><path d="M7 12h2M7 16h2M12 12h.01M12 16h.01"/><path d="M2 21h20"/>');
export const IconContacts = base('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.8 5.8 0 0 1 11 0"/><path d="M16.5 7.2a3 3 0 0 1 0 5.6"/><path d="M18 20a5.5 5.5 0 0 0-2.2-4.4"/>');
export const IconStore = base('<path d="M3.5 9.5 5 4h14l1.5 5.5"/><path d="M4 9.5h16V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M9.5 21v-5.5h5V21"/><path d="M3.5 9.5a2.8 2.8 0 0 0 5.5 0 2.8 2.8 0 0 0 5.5 0 2.8 2.8 0 0 0 5.5 0"/>');
export const IconTeam = base('<circle cx="12" cy="7" r="3"/><path d="M6 21v-1a6 6 0 0 1 12 0v1"/><path d="M3.5 13.5a3.5 3.5 0 0 1 3-3.4"/><path d="M20.5 13.5a3.5 3.5 0 0 0-3-3.4"/>');
export const IconRoute = base('<circle cx="6" cy="5.5" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M6 8v3.5a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v-1"/><path d="M15.5 16.5 18 19l2.5-2.5" opacity=".01"/>');
export const IconVisit = base('<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M8 2.5v4M16 2.5v4M3 9.5h18"/><path d="m9 14.5 2 2 4-4"/>');
export const IconAlert = base('<path d="M10.3 3.8 2.6 17.2A1.9 1.9 0 0 0 4.3 20h15.4a1.9 1.9 0 0 0 1.7-2.8L13.7 3.8a1.9 1.9 0 0 0-3.4 0Z"/><path d="M12 9v4.5M12 17h.01"/>');
export const IconProduct = base('<path d="m12 2.5 8.5 4.7v9.6L12 21.5 3.5 16.8V7.2z"/><path d="m3.5 7.2 8.5 4.8 8.5-4.8M12 12v9.5"/>');
export const IconInventory = base('<path d="M3 9.5 12 4l9 5.5"/><path d="M4.5 10.5V19a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-8.5"/><rect x="9" y="13" width="6" height="7" rx="1"/><path d="M12 6.5v2" opacity=".01"/>');
export const IconSales = base('<path d="M6 2.5h9l4 4V21a.5.5 0 0 1-.7.46L16 20.5l-2.3 1-2.3-1-2.3 1-2.4-1.04A.5.5 0 0 1 6 20z"/><path d="M14.5 2.5V7H19"/><path d="M9 11h6M9 15h4"/>');
export const IconForecast = base('<path d="M3 20h18"/><path d="m4 15 4.5-5 3.5 3.5L20 5"/><path d="M15.5 5H20v4.5"/>');
export const IconReports = base('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 17v-5M12 17V7M16 17v-8"/>');
export const IconSearch = base('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>');
export const IconPlus = base('<path d="M12 5v14M5 12h14"/>');
export const IconLogout = base('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>');
export const IconSun = base('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>');
export const IconMoon = base('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>');
export const IconChevronRight = base('<path d="m9 6 6 6-6 6"/>');
export const IconChevronDown = base('<path d="m6 9 6 6 6-6"/>');
export const IconCheck = base('<path d="m4.5 12.5 5 5 10-11"/>');
export const IconClock = base('<circle cx="12" cy="12" r="9"/><path d="M12 7v5.3l3.4 2"/>');
export const IconPin = base('<path d="M12 21.5s7-6.2 7-11.3A7 7 0 0 0 5 10.2c0 5.1 7 11.3 7 11.3Z"/><circle cx="12" cy="10" r="2.6"/>');
export const IconFilter = base('<path d="M3 5.5h18l-7 8V20l-4 1.5v-8z"/>');
export const IconX = base('<path d="M6 6l12 12M18 6 6 18"/>');
export const IconArrowRight = base('<path d="M4 12h15"/><path d="m13 6 6 6-6 6"/>');
export const IconArrowUp = base('<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>');
export const IconArrowDown = base('<path d="M12 5v14"/><path d="m6 13 6 6 6-6"/>');
export const IconMenu = base('<path d="M4 6h16M4 12h16M4 18h16"/>');
export const IconEdit = base('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7.5 18.5 3 20l1.5-4.5z"/>');
export const IconTrash = base('<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M5.5 7 6.5 20a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1L18.5 7"/><path d="M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7"/>');
export const IconPhone = base('<path d="M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5Z"/>');
export const IconMail = base('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6 8.5-6"/>');
export const IconTarget = base('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>');
export const IconExpiry = base('<circle cx="12" cy="13" r="8"/><path d="M12 9v4.2l2.8 1.6"/><path d="M9 2.5h6"/><path d="m19.5 6.5 1.5-1.5"/>');
export const IconBuilding = base('<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2"/><path d="M10 21v-3h4v3"/>');
export const IconPlug = base('<path d="M9 2v6M15 2v6"/><path d="M6 8h12v3.2a6 6 0 0 1-12 0z"/><path d="M12 17.2V22"/>');
export const IconKey = base('<circle cx="8" cy="15" r="4"/><path d="m10.9 12.1 8-8"/><path d="m15.5 7.5 2 2"/><path d="m18.5 4.5 2 2"/>');
export const IconRefresh = base('<path d="M3.5 12a8.5 8.5 0 0 1 14.6-5.9L21 9"/><path d="M21 4v5h-5"/><path d="M20.5 12a8.5 8.5 0 0 1-14.6 5.9L3 15"/><path d="M3 20v-5h5"/>');
export const IconTruck = base('<path d="M2.5 6.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1V16h-12z"/><path d="M14.5 9.5h3.6l3.4 3.6V16h-7z"/><circle cx="7" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/>');
export const IconExternal = base('<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>');
export const IconSparkle = base('<path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.9L12 18.5l-1.8-5.8-5.7-1.9L10.2 9z"/>');
