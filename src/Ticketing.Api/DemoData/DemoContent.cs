using Ticketing.Domain.Projects;
using Ticketing.Domain.TestCases;
using Ticketing.Domain.Tickets;

namespace Ticketing.Api.DemoData;

internal sealed record DemoUser(string Handle, string Email, string DisplayName);

internal sealed record DemoItem(
    TicketType Type,
    string Title,
    string? Description = null,
    IReadOnlyList<string>? Labels = null,
    IReadOnlyList<DemoItem>? Children = null)
{
    public IReadOnlyList<DemoItem> Kids => Children ?? [];

    public IReadOnlyList<string> OwnLabels => Labels ?? [];
}

/// <param name="Workers">Handles of the people who pick up tickets; repeated handles get more work.</param>
/// <param name="Reporters">Handles that report stories and epics; bugs are reported by <paramref name="Qa"/> when set.</param>
internal sealed record DemoProject(
    string Key,
    string Name,
    string Description,
    ProjectVisibility Visibility,
    string Owner,
    IReadOnlyList<(string Handle, ProjectRole Role)> Members,
    IReadOnlyList<string> Workers,
    IReadOnlyList<string> Reporters,
    string? Qa,
    IReadOnlyList<string> SpareLabels,
    bool Versioned,
    IReadOnlyList<DemoItem> Epics,
    IReadOnlyList<DemoItem> Loose);

internal sealed record DemoTestCase(
    string Project,
    string Title,
    TestCaseStatus Status,
    string? Ticket = null,
    string? Preconditions = null,
    IReadOnlyList<string>? Steps = null,
    string? Expected = null,
    string? Automation = null,
    bool AddedAfterFirstRegression = false);

internal sealed record DemoLink(string Actor, string Source, TicketLinkType Type, string Target);

/// <summary>The demo workspace: people, projects with their epics and tickets, test cases and cross-project links.</summary>
internal static class DemoContent
{
    public static readonly IReadOnlyList<DemoUser> Users =
    [
        new("maya", "maya.kowalczyk@example.com", "Maya Kowalczyk"),
        new("daniel", "daniel.okafor@example.com", "Daniel Okafor"),
        new("sofia", "sofia.lindqvist@example.com", "Sofia Lindqvist"),
        new("tomasz", "tomasz.nowak@example.com", "Tomasz Nowak"),
        new("priya", "priya.raman@example.com", "Priya Raman"),
        new("lucas", "lucas.moreau@example.com", "Lucas Moreau"),
    ];

    public static readonly IReadOnlyList<DemoProject> Projects = [Payments(), WebApp(), PlatformOps()];

    public static readonly IReadOnlyList<DemoLink> CrossLinks =
    [
        new("daniel", "Handle the 3-D Secure challenge in the checkout flow", TicketLinkType.Blocks, "Integrate the 3-D Secure challenge modal"),
        new("sofia", "Manage saved payment methods", TicketLinkType.RelatesTo, "Let customers save a card for future purchases"),
        new("daniel", "Webhook handler times out under load during sales events", TicketLinkType.RelatesTo, "Tune connection pool settings for PgBouncer"),
        new("priya", "A/B test the new checkout against the current one", TicketLinkType.RelatesTo, "Feature flag the new payment methods per market"),
        new("daniel", "Settlement import fails on reports with more than 10 000 rows", TicketLinkType.RelatesTo, "Store settlement reports in S3 for seven years"),
        new("lucas", "Automate failover of the payments database", TicketLinkType.Blocks, "Upgrade production during the maintenance window"),
    ];

    public static readonly IReadOnlyList<DemoTestCase> TestCases =
    [
        new("PAY", "Pay with a Visa card without 3-D Secure", TestCaseStatus.Manual, "Create a PaymentIntent when the customer submits checkout",
            "Stripe test mode. A cart with one product.",
            ["Open the cart and press **Checkout**.", "Fill in the shipping address.", "Pay with card `4242 4242 4242 4242`, any future expiry and CVC."],
            "The order confirmation page shows the order number and the payment is `succeeded` in the Stripe dashboard."),
        new("PAY", "Pay with a card that requires 3-D Secure", TestCaseStatus.Manual, "Handle the 3-D Secure challenge in the checkout flow",
            "Stripe test mode.",
            ["Check out with card `4000 0027 6000 3184`.", "Complete the challenge in the modal.", "Repeat and fail the challenge."],
            "A completed challenge confirms the order; a failed one returns to the payment step with a clear message."),
        new("PAY", "Declined card shows a friendly error", TestCaseStatus.Automatic, Automation: "e2e/payments/declined-card.spec.ts"),
        new("PAY", "Full refund from the back office", TestCaseStatus.Manual, "Refund API for support agents",
            "Signed in as a support agent. A paid order older than one hour.",
            ["Open the order in the back office.", "Press **Refund** and choose **Full refund**.", "Enter the reason and confirm."],
            "The order shows `Refunded`, the refund appears in Stripe and the audit log has an entry."),
        new("PAY", "Partial refund of one order line", TestCaseStatus.Manual, "Partial refund dialog in the back office",
            "A paid order with at least two lines.",
            ["Open the refund dialog.", "Select one line and lower the quantity to 1.", "Confirm the refund."],
            "Only the selected amount is refunded; the order shows `Partially refunded`."),
        new("PAY", "Refund confirmation email", TestCaseStatus.Manual, "Email the customer when a refund is processed",
            "Mailpit is running on staging. A paid order in PLN.",
            ["Refund the order in full.", "Open the email in Mailpit."],
            "The email shows the refunded amount in the order currency and the expected arrival time."),
        new("PAY", "Webhook signature verification rejects tampered payloads", TestCaseStatus.Automatic,
            "Verify Stripe webhook signatures and reject replays", Automation: "tests/Payments.IntegrationTests/WebhookSignatureTests.cs"),
        new("PAY", "Authorised payment is captured exactly once", TestCaseStatus.Automatic,
            "Capture authorised payments when the order ships", Automation: "tests/Payments.IntegrationTests/CaptureTests.cs#CapturesOnce"),
        new("PAY", "Pay with a BLIK code", TestCaseStatus.Manual, "Pay with a BLIK code at checkout",
            "Przelewy24 sandbox. Market set to Poland.",
            ["Choose **BLIK** at checkout.", "Enter the sandbox code `777123`.", "Confirm in the sandbox app simulator."],
            "The order is confirmed within 10 seconds of the confirmation."),
        new("PAY", "BLIK code expires after two minutes", TestCaseStatus.Manual, "Poll BLIK authorisation status until confirmed or timed out",
            "Przelewy24 sandbox.",
            ["Choose **BLIK** and enter a code.", "Do not confirm it for two minutes."],
            "Checkout shows that the code expired and offers to enter a new one."),
        new("PAY", "Przelewy24 statuses map to payment states", TestCaseStatus.Automatic,
            "Map Przelewy24 statuses to internal payment states", Automation: "tests/Payments.UnitTests/P24StatusMapperTests.cs"),
        new("PAY", "Upgrade a subscription mid-cycle", TestCaseStatus.Manual, "Prorate charges when a customer upgrades mid-cycle",
            "A customer on the Basic monthly plan, 10 days into the cycle.",
            ["Open **Account > Subscription**.", "Upgrade to Pro.", "Check the preview and confirm."],
            "The customer is charged only the prorated difference and the next invoice shows the Pro price."),
        new("PAY", "Invoice PDF contains the VAT breakdown", TestCaseStatus.Automatic,
            "Generate invoice PDFs with VAT breakdown", Automation: "tests/Billing.IntegrationTests/InvoicePdfTests.cs"),
        new("PAY", "Pause and resume a subscription", TestCaseStatus.New, "Pause a subscription for up to three months"),
        new("PAY", "Settlement import with more than 10 000 rows", TestCaseStatus.New, "Settlement import fails on reports with more than 10 000 rows"),
        new("PAY", "Save a card during checkout", TestCaseStatus.Manual, "Let customers save a card for future purchases",
            "A signed-in customer without saved cards.",
            ["Check out and tick **Save this card**.", "Start a second checkout."],
            "The saved card is preselected and only needs the CVC.", AddedAfterFirstRegression: true),
        new("WEB", "Checkout on a 320 px wide screen", TestCaseStatus.Manual, "Single-page checkout layout",
            "Chrome device toolbar at 320 x 640.",
            ["Add a product to the cart.", "Go through checkout to the payment step."],
            "No horizontal scrolling; the Pay button is visible without zooming."),
        new("WEB", "Address autocomplete suggests Polish addresses", TestCaseStatus.Manual, "Address autocomplete with the Places API",
            "Market set to Poland.",
            ["Type `Marszałkowska 1` into the street field.", "Pick the first suggestion."],
            "Street, postcode and city are filled in correctly."),
        new("WEB", "Checkout happy path", TestCaseStatus.Automatic, "Single-page checkout layout", Automation: "e2e/checkout/happy-path.spec.ts"),
        new("WEB", "Theme follows the operating system", TestCaseStatus.Manual, "Follow the operating system colour scheme by default",
            "No theme saved in the profile.",
            ["Switch the OS to dark mode.", "Reload the app.", "Switch the OS back to light mode."],
            "The app follows the OS theme without a reload."),
        new("WEB", "Keyboard-only checkout", TestCaseStatus.Manual, "Keyboard navigation for the product grid",
            "Mouse disconnected.",
            ["Find a product with the keyboard.", "Add it to the cart.", "Complete checkout using only Tab, Enter and Space."],
            "Every step is reachable and the focus is always visible."),
        new("WEB", "Screen reader announces form errors", TestCaseStatus.Manual, "Error messages are not announced by screen readers",
            "NVDA with Firefox.",
            ["Submit the address form empty."],
            "NVDA reads the error summary and focus moves to the first invalid field."),
        new("WEB", "Lighthouse performance budget", TestCaseStatus.Automatic, "Add Lighthouse CI with budgets", Automation: ".github/workflows/lighthouse.yml"),
        new("WEB", "Order history filters", TestCaseStatus.Automatic, "Order history with filters", Automation: "e2e/account/order-history.spec.ts"),
        new("WEB", "German price formatting", TestCaseStatus.New, "Prices show a comma and a dot in the German locale"),
        new("WEB", "Language switcher keeps the current page", TestCaseStatus.New, "Language switcher in the footer"),
    ];

    private static DemoProject Payments() => new(
        "PAY", "Payments",
        "Checkout payments, refunds, subscriptions and payouts. Owned by the Payments squad; on-call rotation in #payments-oncall.",
        ProjectVisibility.Public, "maya",
        [("daniel", ProjectRole.Member), ("sofia", ProjectRole.Member), ("tomasz", ProjectRole.Member), ("priya", ProjectRole.Member)],
        ["daniel", "daniel", "daniel", "sofia", "maya", "tomasz"],
        ["priya", "priya", "maya", "daniel"],
        "tomasz",
        ["backend", "frontend", "tech-debt"],
        Versioned: true,
        [
            Epic("Card payments with Stripe Payment Intents", """
                Move every card payment from the legacy Charges API to **Payment Intents**, so that we support SCA and 3-D Secure 2
                everywhere and can add wallets later without another rewrite.

                | Milestone | Target | Status |
                | --- | --- | --- |
                | PaymentIntent created at checkout | 1.4.0 | Done |
                | 3-D Secure challenge | 1.4.0 | Done |
                | Webhooks drive order state | 1.5.0 | In progress |
                | Charges API switched off | 1.5.0 | Planned |

                **Success metric:** card authorisation rate in the EEA above 92 % (today 87 %).
                """, "stripe",
                Story("Create a PaymentIntent when the customer submits checkout", """
                    As a customer, I want my card payment to be authorised in one step, so that checkout feels fast and works with SCA.

                    ## Acceptance criteria

                    - [ ] Submitting checkout creates a PaymentIntent with the order total and currency
                    - [ ] The intent carries `order_id` in its metadata
                    - [ ] A retried submit reuses the same intent (idempotency key = order id)

                    ```csharp
                    var intent = await stripe.PaymentIntents.CreateAsync(new PaymentIntentCreateOptions
                    {
                        Amount = order.Total.MinorUnits,
                        Currency = order.Total.Currency.ToLowerInvariant(),
                        Metadata = new() { ["order_id"] = order.Id.ToString() },
                    }, new RequestOptions { IdempotencyKey = $"order-{order.Id}" });
                    ```
                    """,
                    Tech("Persist the PaymentIntent id on the order"),
                    Tech("Retry PaymentIntent creation on Stripe 5xx with exponential backoff")),
                Story("Handle the 3-D Secure challenge in the checkout flow"),
                Tech("Webhook endpoint for payment_intent events", """
                    Order state must follow Stripe, not the browser. Handle these events:

                    | Event | Order transition |
                    | --- | --- |
                    | `payment_intent.succeeded` | Pending → Paid |
                    | `payment_intent.payment_failed` | Pending → PaymentFailed |
                    | `payment_intent.canceled` | Pending → Cancelled |
                    | `charge.refunded` | Paid → Refunded |

                    Events are stored in `payment_events` first and processed by the outbox worker, so a slow handler never makes Stripe retry.
                    """),
                Tech("Verify Stripe webhook signatures and reject replays"),
                Story("Capture authorised payments when the order ships"),
                Story("Show card brand and last four digits on the receipt"),
                Story("Save the payment method on successful payment"),
                Bug("Customer charged twice after double-clicking Pay", """
                    Support reported three customers charged twice for the same order on Friday evening.

                    ## Steps to reproduce

                    1. Use a slow connection (Chrome DevTools, *Slow 3G*).
                    2. Fill in checkout with card `4242 4242 4242 4242`.
                    3. Double-click **Pay**.

                    **Expected:** one PaymentIntent, one charge.
                    **Actual:** two PaymentIntents, both captured.

                    ```text
                    2026-08-14T18:02:11Z pi_3Pq... created order=1048812
                    2026-08-14T18:02:11Z pi_3Pq... created order=1048812
                    ```

                    The idempotency key is generated per click instead of per order.
                    """),
                Spike("Evaluate Stripe Radar rules for high-risk orders")),
            Epic("Refunds and partial refunds", """
                Support agents can refund orders themselves instead of asking engineering. Today about **40 refund requests per week**
                go through Slack and take on average two days.

                ## Scope

                - Full and partial refunds from the back office
                - Customer notification email
                - Four-eyes approval above 1 000 EUR
                - Reconciliation with Stripe refund webhooks
                """, "refunds",
                Story("Refund API for support agents",
                    Tech("Add a refund reason to refunds")),
                Story("Partial refund dialog in the back office"),
                Tech("Reconcile refund webhooks with internal refund records"),
                Story("Email the customer when a refund is processed"),
                Bug("JPY refunds are off by a factor of 100", """
                    Zero-decimal currencies are multiplied by 100 before calling the refunds API.

                    | Currency | Requested | Sent to Stripe |
                    | --- | --- | --- |
                    | EUR | 12.50 | 1250 |
                    | JPY | 1500 | 150000 |

                    Use `Money.MinorUnits`, which already knows about zero-decimal currencies.
                    """),
                Bug("Refund button stays enabled after a full refund"),
                Story("Require a second approval for refunds over 1 000 EUR"),
                Tech("Audit log entries for refund approvals")),
            Epic("BLIK and Przelewy24 payment methods", """
                Poland is our fastest-growing market and **62 %** of Polish online payments are BLIK. Add BLIK and Przelewy24 bank
                transfers through Przelewy24.

                | Metric | Today | Goal |
                | --- | --- | --- |
                | Checkout conversion (PL) | 2.1 % | 2.8 % |
                | Share of card payments (PL) | 91 % | 55 % |
                """, "blik",
                Spike("Compare Przelewy24 and PayU for BLIK acquiring"),
                Story("Pay with a BLIK code at checkout",
                    Tech("Poll BLIK authorisation status until confirmed or timed out")),
                Story("Show the Przelewy24 bank list with logos"),
                Tech("Map Przelewy24 statuses to internal payment states"),
                Tech("BLIK refunds through the Przelewy24 API"),
                Bug("BLIK code input accepts letters on Android keyboards"),
                Story("Feature flag the new payment methods per market")),
            Epic("PCI DSS 4.0 readiness", """
                PCI DSS 4.0 future-dated requirements become mandatory on 31 March 2025 for most merchants; our QSA assessment is in
                November. This epic collects the remediation work from the gap analysis.
                """, "pci,security",
                Tech("Remove card numbers from application logs", """
                    The gap analysis found masked but **not truncated** PANs in debug logs of the checkout service.

                    ```yaml
                    Serilog:
                      Destructure:
                        - Name: With
                          Args:
                            policy: Payments.Logging.CardDataMaskingPolicy
                    ```

                    - [ ] Add the masking policy to every service that touches card data
                    - [ ] Purge the affected log indices older than 7 days
                    - [ ] Add a CI check that fails on 13-19 digit sequences in log fixtures
                    """),
                Tech("Rotate encryption keys for vaulted payment tokens"),
                Tech("Enforce TLS 1.2 or newer on the payments API"),
                Tech("Restrict production database access to break-glass accounts"),
                Spike("Tokenisation provider comparison"),
                Story("Quarterly ASV scan remediation"),
                Tech("Script the evidence export for the QSA")),
            Epic("Subscription billing", """
                Self-service plans for business customers: monthly and yearly billing, upgrades with proration, dunning and invoices.
                """, "subscriptions",
                Story("Prorate charges when a customer upgrades mid-cycle"),
                Story("Dunning emails for failed renewals",
                    Tech("Schedule retries on day 1, 3 and 7 after a failed renewal")),
                Story("Generate invoice PDFs with VAT breakdown"),
                Bug("Trial end date is one day early for customers east of UTC"),
                Story("Pause a subscription for up to three months"),
                Story("Customer self-service cancellation",
                    Tech("Send cancellation survey answers to analytics")),
                Tech("Backfill subscription events into the data warehouse")),
            Epic("Payout reconciliation", """
                Finance reconciles Stripe payouts by hand in a spreadsheet every Monday (about 6 hours). Automate the matching and
                surface only the mismatches.
                """, "reconciliation",
                Tech("Import the daily Stripe settlement report"),
                Story("Match payouts to orders and flag mismatches"),
                Story("Mismatch dashboard for the finance team"),
                Bug("Settlement import fails on reports with more than 10 000 rows"),
                Tech("Alert finance when unmatched payouts exceed 0.5 %"),
                Tech("Store settlement reports in S3 for seven years")),
        ],
        [
            Bug("Currency symbol missing on the payment failed page", labels: "frontend"),
            Bug("Webhook handler times out under load during sales events", """
                During the Black Week rehearsal the webhook endpoint answered in **8-12 s** at 300 events/s and Stripe started retrying.

                ```sql
                SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Client';
                -- 97 of 100 connections waiting
                ```

                Likely the connection pool: every event opens a transaction before it is queued.
                """, "backend"),
            Tech("Upgrade Stripe.net to v48", labels: "tech-debt"),
            Tech("Remove the legacy PayPal Express integration", labels: "tech-debt"),
            Bug("Receipt email shows UTC time instead of the customer's time zone"),
            Tech("Add OpenTelemetry spans around payment provider calls", labels: "backend"),
            Story("Let customers save a card for future purchases"),
            Bug("Apple Pay button flickers on Safari 18", labels: "frontend"),
            Spike("Can we support Google Pay without a new acquirer?"),
            Tech("Split PaymentService into authorisation and capture services", labels: "tech-debt,backend"),
            Bug("Duplicate order confirmation emails after a webhook retry"),
            Tech("Contract tests for the payments API", labels: "backend"),
            Bug("Payment page shows 'undefined' when the provider is down", labels: "frontend"),
            Tech("Delete unused Stripe test webhooks", labels: "tech-debt"),
            Story("Support Swish for Swedish customers"),
        ]);

    private static DemoProject WebApp() => new(
        "WEB", "Web App",
        "The customer-facing web shop (Angular). Design system, checkout UI, account area and performance.",
        ProjectVisibility.Public, "sofia",
        [("maya", ProjectRole.Member), ("daniel", ProjectRole.Member), ("tomasz", ProjectRole.Member), ("priya", ProjectRole.Member)],
        ["sofia", "sofia", "sofia", "daniel", "maya", "tomasz"],
        ["priya", "priya", "sofia"],
        "tomasz",
        ["mobile", "design", "tech-debt"],
        Versioned: true,
        [
            Epic("Checkout redesign", """
                Replace the four-step checkout with a single page. Usability tests (n = 12) showed that 5 people lost their cart when
                going back from the payment step.

                | Step | Today (median) | Goal |
                | --- | --- | --- |
                | Cart → payment | 94 s | 45 s |
                | Payment → confirmation | 31 s | 20 s |

                Ships behind `checkout.new-layout`, rolled out by percentage.
                """, "checkout,ui",
                Story("Single-page checkout layout", """
                    As a customer, I want to see address, delivery and payment on one page, so that I can check out without losing my place.

                    ## Acceptance criteria

                    - [ ] Sections collapse to a summary once completed
                    - [ ] The order summary stays visible on desktop (≥ 1024 px)
                    - [ ] Works with the keyboard only
                    - [ ] Hidden behind the `checkout.new-layout` flag
                    """,
                    Tech("Extract the address form into a standalone component"),
                    Tech("Move checkout state into a signal store")),
                Story("Address autocomplete with the Places API"),
                Story("Sticky order summary on desktop"),
                Story("Integrate the 3-D Secure challenge modal"),
                Bug("Pay button hidden behind the cookie banner on iPhone SE", """
                    On 375 x 667 screens the consent banner covers the bottom 120 px, including **Pay**.

                    | Device | Browser | Reproducible |
                    | --- | --- | --- |
                    | iPhone SE (3rd gen) | Safari 18 | Yes |
                    | Pixel 7 | Chrome | No |

                    Fix: reserve space with `padding-bottom: env(safe-area-inset-bottom)` and the banner height.
                    """, "mobile"),
                Story("A/B test the new checkout against the current one"),
                Bug("Promo code field loses focus after each keystroke"),
                Tech("Checkout analytics events")),
            Epic("Dark mode", """
                Top feature request in the last two customer surveys. Build it on design tokens so that both themes stay consistent.
                """, "ui,design",
                Tech("Introduce colour tokens for light and dark themes", """
                    ```scss
                    :root {
                      --color-surface: #ffffff;
                      --color-text: #1f2328;
                    }
                    :root[data-theme='dark'] {
                      --color-surface: #0d1117;
                      --color-text: #e6edf3;
                    }
                    ```

                    - [ ] Replace hard-coded colours in components (about 140 occurrences)
                    - [ ] Stylelint rule that forbids hex colours outside the token file
                    """),
                Story("Theme toggle in the user menu"),
                Story("Follow the operating system colour scheme by default"),
                Bug("Charts are unreadable in dark mode"),
                Bug("Logo has a white box around it in dark mode"),
                Tech("Dark theme screenshots in visual tests")),
            Epic("Accessibility: WCAG 2.2 AA", """
                External audit in June found **23 issues** (4 critical). We committed to fixing all critical and serious issues before
                the public sector tender in Q4.
                """, "a11y",
                Story("Keyboard navigation for the product grid"),
                Tech("Visible focus styles for all interactive elements"),
                Story("Screen reader labels for icon-only buttons"),
                Tech("Fix colour contrast issues from the audit"),
                Spike("Run axe checks in CI"),
                Bug("Modal dialogs do not trap focus"),
                Bug("Error messages are not announced by screen readers"),
                Story("Skip to main content link")),
            Epic("Performance budget", """
                Keep the shop fast on mid-range phones: LCP under 2.5 s and a main bundle under 250 kB (gzip) on 4G.
                """, "performance",
                Tech("Lazy-load product images below the fold"),
                Tech("Split the vendor bundle by route"),
                Spike("Server-side rendering for the landing page"),
                Bug("Layout shift on the product page when web fonts load"),
                Tech("Add Lighthouse CI with budgets"),
                Story("Prefetch the checkout route when the cart opens"),
                Bug("Main bundle exceeds the 300 kB budget")),
            Epic("Customer account area", """
                Let customers manage orders, invoices and payment methods themselves; 30 % of support tickets are "where is my invoice".
                """, "account",
                Story("Order history with filters",
                    Tech("Paged orders endpoint for the account area")),
                Story("Manage saved payment methods"),
                Story("Download invoices as PDF"),
                Story("Change email address with confirmation"),
                Bug("Order history shows cancelled orders as paid"),
                Story("Delete my account")),
            Epic("Internationalisation", """
                Launch in Poland and Germany: translations, locale-aware formatting and a language switcher.
                """, "i18n",
                Tech("Extract UI strings into translation files"),
                Story("Polish translation"),
                Story("German translation"),
                Tech("Locale-aware currency and date formatting"),
                Bug("Prices show a comma and a dot in the German locale"),
                Story("Language switcher in the footer")),
        ],
        [
            Bug("Search results flash empty before loading"),
            Tech("Upgrade to Angular 21", """
                ```bash
                ng update @angular/core@21 @angular/cli@21
                ng generate @angular/core:control-flow
                ```

                - [ ] Remove the remaining `NgModule`s
                - [ ] Switch tests to Vitest
                - [ ] Check bundle size against the budget
                """, "tech-debt"),
            Bug("Session expires silently while filling in checkout"),
            Tech("Remove the unused Moment.js dependency", labels: "tech-debt,performance"),
            Story("Show the delivery estimate on the product page"),
            Bug("Broken image placeholders on slow connections", labels: "mobile"),
            Tech("Storybook stories for the UI kit", labels: "design"),
            Spike("Evaluate Playwright component tests"),
            Bug("Newsletter sign-up returns 500 for plus addresses"),
            Story("Wishlist sharing link"),
            Bug("Footer links overlap on 320 px screens", labels: "mobile"),
            Tech("Replace the custom carousel with CSS scroll snap", labels: "tech-debt"),
            Story("Recently viewed products"),
        ]);

    private static DemoProject PlatformOps() => new(
        "OPS", "Platform Ops",
        "Infrastructure, databases, CI/CD and on-call. Private: contains incident details and internal hostnames.",
        ProjectVisibility.Private, "lucas",
        [("daniel", ProjectRole.Member), ("maya", ProjectRole.Member), ("priya", ProjectRole.Viewer)],
        ["lucas", "lucas", "lucas", "daniel"],
        ["lucas", "lucas", "maya"],
        null,
        ["on-call", "tech-debt"],
        Versioned: false,
        [
            Epic("Upgrade PostgreSQL to 18", """
                All clusters run PostgreSQL 15, which leaves extended support in 2027. Upgrade staging first, rehearse on a production
                snapshot, then production in one maintenance window per cluster.

                | Cluster | Size | Window |
                | --- | --- | --- |
                | payments-db | 1.2 TB | Sun 02:00-04:00 CET |
                | shop-db | 380 GB | Sun 02:00-03:00 CET |
                | analytics-db | 4.8 TB | Sat 22:00-02:00 CET |
                """, "postgres",
                Tech("Upgrade the staging cluster"),
                Tech("Rehearse pg_upgrade on a production snapshot", """
                    ```bash
                    pg_upgrade --old-bindir=/usr/lib/postgresql/15/bin --new-bindir=/usr/lib/postgresql/18/bin \
                      --old-datadir=/data/15 --new-datadir=/data/18 --link --jobs=8 --check
                    ```

                    Record the duration of `--link` mode and of `vacuumdb --analyze-in-stages`; both go into the change request.
                    """),
                Tech("Tune connection pool settings for PgBouncer"),
                Tech("Write the rollback runbook"),
                Spike("Measure the impact of asynchronous I/O in PostgreSQL 18"),
                Tech("Upgrade production during the maintenance window")),
            Epic("Observability stack", """
                One place for metrics, logs and traces with SLO-based alerting, replacing the per-team Grafana instances.
                """, "monitoring",
                Tech("Deploy the OpenTelemetry collector"),
                Tech("Grafana dashboards for API latency and error rate"),
                Tech("Alert on error budget burn rate", """
                    Multi-window burn-rate alerts as in the SRE workbook:

                    | Window | Burn rate | Severity |
                    | --- | --- | --- |
                    | 1 h / 5 m | 14.4 | page |
                    | 6 h / 30 m | 6 | page |
                    | 3 d / 6 h | 1 | ticket |
                    """),
                Spike("Loki or Elasticsearch for logs"),
                Tech("Trace sampling rules for high-traffic endpoints"),
                Tech("SLO definitions for checkout and payments"),
                Bug("Prometheus scrapes time out on node-exporter")),
            Epic("Kubernetes cost optimisation", """
                The cloud bill grew 38 % year over year while traffic grew 12 %. Target: minus 25 % on compute by the end of the quarter.
                """, "k8s,cost",
                Tech("Right-size the general node pool"),
                Tech("Enable the cluster autoscaler"),
                Tech("Run CI runners on spot instances"),
                Tech("Set resource requests for all workloads"),
                Spike("Reserved instances or savings plans"),
                Bug("Autoscaler removes nodes running batch jobs")),
            Epic("Disaster recovery", """
                Agreed targets with the business: **RPO 15 minutes, RTO 4 hours** for payments and the shop. Prove them with drills.
                """, "security",
                Tech("Replicate nightly backups to a second region"),
                Tech("Quarterly restore drill"),
                Tech("Document RTO and RPO per service"),
                Tech("Automate failover of the payments database"),
                Spike("Cross-region replication costs")),
            Epic("CI/CD hardening", """
                Supply-chain findings from the last penetration test: unpinned actions, long-lived secrets and unsigned images.
                """, "ci,security",
                Tech("Pin GitHub Actions to commit SHAs"),
                Tech("Sign container images with cosign"),
                Tech("Move secrets from CI variables to Vault"),
                Bug("Flaky deploy step when two pipelines run at once"),
                Tech("Dependency update bot for base images")),
        ],
        [
            Bug("TLS certificate for api.example.com expires in 14 days", labels: "on-call,security"),
            Bug("Disk pressure on runner-03", labels: "on-call"),
            Tech("Rotate the database superuser password", labels: "security"),
            Bug("Nightly backup job failed on Sunday", """
                ```text
                pg_dump: error: query failed: SSL SYSCALL error: EOF detected
                backup-payments-db-29351840-x7k2p  0/1  Error  0  3h
                ```

                The job restarted after the node was preempted. Backups must not run on spot nodes.
                """, "on-call"),
            Tech("Upgrade ingress-nginx to 1.12"),
            Tech("Decommission the old Jenkins server", labels: "tech-debt"),
            Bug("DNS resolution spikes in the payments namespace", labels: "on-call"),
            Tech("On-call handbook: escalation policy", labels: "on-call"),
            Bug("Grafana alert emails go to an old distribution list", labels: "on-call"),
            Tech("Clean up orphaned load balancers", labels: "cost"),
            Bug("Pod restarts in the search namespace after OOM", labels: "on-call"),
        ]);

    private static DemoItem Epic(string title, string description, string labels, params DemoItem[] children) =>
        new(TicketType.Epic, title, Trim(description), Split(labels), children);

    private static DemoItem Story(string title, params DemoItem[] children) =>
        new(TicketType.UserStory, title, null, [], children);

    private static DemoItem Story(string title, string description, params DemoItem[] children) =>
        new(TicketType.UserStory, title, Trim(description), [], children);

    private static DemoItem Tech(string title, string? description = null, string? labels = null) =>
        new(TicketType.Technical, title, Trim(description), Split(labels));

    private static DemoItem Bug(string title, string? description = null, string? labels = null) =>
        new(TicketType.Bug, title, Trim(description), Split(labels));

    private static DemoItem Spike(string title, string? description = null, string? labels = null) =>
        new(TicketType.Spike, title, Trim(description), Split(labels));

    private static string? Trim(string? text) => text?.Trim();

    private static List<string> Split(string? labels) =>
        labels is null ? [] : [.. labels.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)];
}
