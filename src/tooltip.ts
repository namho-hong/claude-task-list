import "./tooltip.css";
import { listen } from "@tauri-apps/api/event";

type TooltipPayload =
  | { type: "text"; text: string }
  | { type: "list"; items: { subject: string; status: string }[]; moreCount: number };

const root = document.getElementById("tooltip-root")!;

function render(payload: TooltipPayload) {
  if (payload.type === "text") {
    root.innerHTML = `<div class="tip tip-text">${escapeHtml(payload.text)}</div>`;
  } else {
    const items = payload.items
      .map((item) => {
        const icon =
          item.status === "completed"
            ? '<span class="icon completed">✓</span>'
            : item.status === "in_progress"
              ? '<span class="icon active">◉</span>'
              : '<span class="icon">○</span>';
        return `<div class="list-item">${icon}<span class="subject">${escapeHtml(item.subject)}</span></div>`;
      })
      .join("");
    const more =
      payload.moreCount > 0
        ? `<div class="list-more">+${payload.moreCount} more</div>`
        : "";
    root.innerHTML = `<div class="tip tip-list">${items}${more}</div>`;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

listen<TooltipPayload>("tooltip-update", (event) => {
  render(event.payload);
});
