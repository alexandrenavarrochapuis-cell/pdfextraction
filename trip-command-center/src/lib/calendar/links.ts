// One-tap subscribe links for the calendar feed. Each calendar app takes a
// feed its own way; pasting the link by hand works in all of them.

export interface SubscribeLink {
  label: string;
  href: string;
}

export function subscribeLinks(feedUrl: string): SubscribeLink[] {
  const webcal = feedUrl.replace(/^https?:/, "webcal:");
  const url = encodeURIComponent(feedUrl);
  return [
    // Opens Google Calendar on the web with the "Add calendar" prompt; it then
    // syncs to the Calendar app on Android.
    { label: "Google Calendar", href: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}` },
    { label: "Outlook (work)", href: `https://outlook.office.com/calendar/0/addfromweb?url=${url}&name=Atlas` },
    { label: "Outlook.com", href: `https://outlook.live.com/calendar/0/addfromweb?url=${url}&name=Atlas` },
    // webcal: opens the Calendar app on iPhone, iPad and Mac.
    { label: "Apple Calendar", href: webcal },
  ];
}
