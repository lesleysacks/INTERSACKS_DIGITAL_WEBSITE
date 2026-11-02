# Analytics

Google Analytics 4 is installed with the Google tag, measurement ID `G-Q85HJEHCZ7`. The loader is `js/analytics.js`. It is included once on each public indexable page.

The Google tag script is requested only when the hostname is `www.intersacks.co.za` or `intersacks.co.za`. Local and preview hosts still record events in `dataLayer` so the events can be tested, but they do not download `gtag.js` and do not send those hits to the InterSacks property.

Enhanced Measurement stays at Google’s default. The site does not send its own `page_view`, scroll, or generic outbound-click events. The custom events below use different event names.

## Events

| Event | When it is sent | Parameters |
|---|---|---|
| `whatsapp_click` | A WhatsApp link is clicked | `page_path`, `link_location`, and `service_name` when the link is inside a service section |
| `email_click` | A `mailto:` link is clicked | `page_path`, `link_location` |
| `phone_click` | A `tel:` link is clicked | `page_path`, `link_location` |
| `quote_request_click` | A link whose text says “Request a quote” or “quote request” is clicked | `page_path`, `link_location`, `service_name` when relevant |
| `service_view` | The heading of a service section is in view, once per section per page load | `service_name`, `page_path`, `link_location` |
| `contact_page_view` | The contact page loads, once | `page_path`, `link_location` |

`link_location` is one of `header`, `mobile-nav`, `footer`, `hero`, `service`, `contact`, `floating`, or `page`.

Navigation links such as “Contact” and “Start a project” are not quote events. The form still opens the visitor’s email app. Its field values are not sent to Analytics.

## Key events

Mark these as key events in Google Analytics after the tag is receiving data:

- `whatsapp_click`
- `quote_request_click`
- `email_click`

Do not mark `page_view`, `contact_page_view`, `service_view`, or `phone_click` as key events unless the business later decides otherwise.

In GA4: Admin, Data display, Events. Wait until the event appears, then turn on “Mark as key event”. The website cannot switch that setting on by itself.

## Privacy

The tag does not receive names, email addresses, telephone numbers, WhatsApp numbers, or enquiry text. `page_path` is the path only, without a query string.

The public notice is `privacy.html`, linked from the site footer and from the four browser tools. It describes the measurement, the custom events, the enquiry details that are not sent, and how a visitor can delete or block cookies in the browser. It does not name a lawful basis under POPIA, and it does not claim the tag is switched off.

No consent banner was added. A banner that did not actually control the tag would be misleading. On the production host, the Google tag can set its usual analytics cookies and sends technical data, including the IP address, to Google. The business still needs a lawful basis under POPIA for this measurement. If a consent requirement is adopted later, load the tag through Google Consent Mode instead of adding a notice that does not change what is collected.

Pages that are not indexable, including the payments notice, the 404 page, and the greeting-card templates, do not load this file.
