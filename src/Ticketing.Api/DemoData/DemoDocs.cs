using Ticketing.Domain.Docs;

namespace Ticketing.Api.DemoData;

/// <summary>Resolves the keys a demo doc mentions while it is written: tickets by title, docs by handle.</summary>
internal interface IDemoDocRefs
{
    string Ticket(string title);

    string Doc(string handle);
}

/// <summary>A later version of a demo doc: <see cref="Edit"/> turns the previous content into the new one.</summary>
internal sealed record DemoDocRevision(double DaysAgo, string Author, string ChangeNote, Func<IDemoDocRefs, string, string> Edit);

internal sealed record DemoDocComment(double DaysAgo, string Author, Func<IDemoDocRefs, string> Body);

/// <param name="Handle">Unique name other demo docs use to link or embed this one.</param>
/// <param name="Folder">Handle of the parent folder; null for the top level.</param>
internal sealed record DemoDoc(
    string Handle,
    DocKind Kind,
    string Title,
    string? Folder,
    string Author,
    double DaysAgo,
    Func<IDemoDocRefs, string>? Content = null,
    DiagramFormat? Format = null,
    DemoCanvas? Canvas = null,
    IReadOnlyList<DemoDocRevision>? Revisions = null,
    IReadOnlyList<DemoDocComment>? Comments = null);

internal sealed record DemoDocTree(string ProjectKey, IReadOnlyList<DemoDoc> Docs);

/// <summary>
/// The docs of each demo project (TKT-22): two folders, four pages with callouts, tables, code and ticket mentions, a
/// Mermaid and a Canvas diagram embedded in a page, a few later versions and comments. Docs are listed parents first and
/// each doc only links to docs listed before it.
/// </summary>
internal static class DemoDocs
{
    public static readonly IReadOnlyList<DemoDocTree> Trees = [Payments(), WebApp(), PlatformOps()];

    private static DemoDoc Folder(string handle, string title, string author, double daysAgo, string? parent = null) =>
        new(handle, DocKind.Folder, title, parent, author, daysAgo);

    private static DemoDocTree Payments() => new("PAY",
    [
        Folder("pay-architecture", "Architecture", "maya", 48),
        Folder("pay-runbooks", "Runbooks", "tomasz", 46),
        new("pay-sequence", DocKind.Diagram, "Checkout payment sequence", "pay-architecture", "daniel", 44,
            _ => """
                sequenceDiagram
                  actor C as Customer
                  participant W as Web App
                  participant P as Payments API
                  participant S as Stripe
                  C->>W: Press Pay
                  W->>P: POST /payments (order id)
                  P->>S: Create PaymentIntent (idempotency key = order id)
                  S-->>P: client_secret
                  P-->>W: client_secret
                  W->>S: confirmCardPayment
                  alt 3-D Secure required
                    S-->>C: Challenge
                    C->>S: Approve
                  end
                  S-)P: payment_intent.succeeded (webhook)
                  P->>P: Order Pending → Paid
                """,
            DiagramFormat.Mermaid,
            Revisions:
            [
                new(20, "daniel", "Show the webhook as the source of truth", (_, text) => text.Replace(
                    "  P->>P: Order Pending → Paid", "  P->>P: Store event, outbox worker marks the order Paid", StringComparison.Ordinal)),
            ]),
        new("pay-sketch", DocKind.Diagram, "Payment architecture sketch", "pay-architecture", "sofia", 43,
            Format: DiagramFormat.Canvas,
            Canvas: new DemoCanvas()
                .Box("shop", 0, 0, "Web App", "#a5d8ff")
                .Box("api", 320, 0, "Payments API", "#b2f2bb")
                .Box("stripe", 640, 0, "Stripe", "#d0bfff")
                .Box("db", 320, 180, "payment_events", "#ffec99")
                .Box("worker", 640, 180, "Outbox worker", "#b2f2bb")
                .Arrow("shop", "api", "REST")
                .Arrow("api", "stripe", "intents")
                .Arrow("api", "db", "store")
                .Arrow("db", "worker")),
        new("pay-overview", DocKind.Page, "Payment flow overview", "pay-architecture", "daniel", 42,
            r => $$"""
                Card payments go through **Stripe Payment Intents**. This page explains how an order gets paid and where to look when it does not. The migration is tracked in {{r.Ticket("Card payments with Stripe Payment Intents")}}.

                > [!NOTE]
                > The order state follows Stripe's webhooks, never the browser. A customer closing the tab after paying still gets a paid order.

                ## How a payment flows

                ![Checkout payment sequence]({{r.Doc("pay-sequence")}})

                1. Checkout creates the PaymentIntent ({{r.Ticket("Create a PaymentIntent when the customer submits checkout")}}).
                2. The browser confirms it, with a 3-D Secure challenge when the bank asks for one.
                3. Stripe calls our webhook ({{r.Ticket("Webhook endpoint for payment_intent events")}}), which moves the order on.

                ## Components

                ![Payment architecture sketch]({{r.Doc("pay-sketch")}})

                | Component | Owner | Notes |
                | --- | --- | --- |
                | Payments API | Payments squad | Creates intents, handles refunds |
                | Outbox worker | Payments squad | Processes `payment_events` in order |
                | Stripe | External | Test mode on staging, live keys only in production |

                ## Idempotency

                Every call to Stripe carries the order id as idempotency key, which fixed {{r.Ticket("Customer charged twice after double-clicking Pay")}}:

                ```csharp
                var options = new RequestOptions { IdempotencyKey = $"order-{order.Id}" };
                var intent = await stripe.PaymentIntents.CreateAsync(create, options);
                ```
                """,
            Revisions:
            [
                new(30, "maya", "Add the failure handling section", (r, text) => text + $$"""


                    ## When a payment fails

                    > [!WARNING]
                    > Never retry a declined card automatically. Show the decline reason and let the customer choose.

                    Provider outages surface as {{r.Ticket("Payment page shows 'undefined' when the provider is down")}} until the friendly error page ships.
                    """),
                new(9, "daniel", "Link the webhook decision", (r, text) => text.Replace(
                    "never the browser.", $"never the browser ([why]({r.Doc("pay-adr")})).", StringComparison.Ordinal)),
            ],
            Comments:
            [
                new(29, "sofia", r => $"Should the sketch show the 3-D Secure redirect too? {r.Ticket("Integrate the 3-D Secure challenge modal")} touches it on the web side."),
                new(28, "daniel", _ => "Good point. It is in the sequence diagram; I kept the sketch to the components."),
            ]),
        new("pay-adr", DocKind.Page, "ADR-007: Webhooks drive the order state", "pay-architecture", "daniel", 40,
            r => $$"""
                - Status: Accepted
                - Deciders: Daniel Okafor, Maya Kowalczyk

                ## Context

                The browser used to mark orders as paid after `confirmCardPayment` returned. Closed tabs and flaky mobile networks left paid orders in `Pending`, and support fixed them by hand.

                ## Decision

                Only Stripe webhooks change the order state. The handler stores the event in `payment_events` and returns `200` at once; the outbox worker applies it. See [Payment flow overview]({{r.Doc("pay-overview")}}).

                > [!IMPORTANT]
                > Webhook signatures are verified before anything is stored ({{r.Ticket("Verify Stripe webhook signatures and reject replays")}}).

                ## Consequences

                | | |
                | --- | --- |
                | Good | Orders are correct even when the customer leaves early |
                | Bad | The confirmation page has to poll until the webhook arrives (usually under 2 s) |
                """),
        new("pay-refund", DocKind.Page, "Refund a payment manually", "pay-runbooks", "tomasz", 35,
            r => $$"""
                Use this only when the back office refund ({{r.Ticket("Refund API for support agents")}}) is unavailable.

                > [!CAUTION]
                > A manual refund bypasses the four-eyes approval. Ask the payments on-call before refunding more than 1 000 EUR.

                ## Steps

                1. Find the PaymentIntent of the order:

                   ```sql
                   SELECT provider_reference FROM payments WHERE order_id = :order_id AND status = 'Paid';
                   ```

                2. Refund it in the Stripe dashboard and write the order number into the reason.
                3. Mark the order as refunded so the reconciliation does not flag it:

                   ```bash
                   ./ops refund-mark --order 1048812 --reason "manual refund, ticket PAY-123"
                   ```

                ## Amounts

                | Currency | Minor units | Example |
                | --- | --- | --- |
                | EUR, PLN | 2 | 12.50 → `1250` |
                | JPY | 0 | 1500 → `1500` |

                > [!TIP]
                > Zero-decimal currencies were the cause of {{r.Ticket("JPY refunds are off by a factor of 100")}}. Always use `Money.MinorUnits`.
                """,
            Revisions:
            [
                new(12, "daniel", "Mention the reconciliation job", (_, text) => text.Replace(
                    "so the reconciliation does not flag it:", "so the nightly reconciliation does not flag it as a mismatch:", StringComparison.Ordinal)),
            ]),
        new("pay-release", DocKind.Page, "Release checklist", "pay-runbooks", "tomasz", 14,
            r => $$"""
                Run through this list before every Payments release. The regression session covers the test cases; this list covers everything around it.

                > [!IMPORTANT]
                > Releases happen Tuesday to Thursday before 14:00, never during a sales event.

                - [x] Regression session completed and failed items have bugs
                - [x] {{r.Ticket("Upgrade Stripe.net to v48")}} is merged or moved to the next release
                - [ ] Feature flags for the new payment methods checked per market ({{r.Ticket("Feature flag the new payment methods per market")}})
                - [ ] Webhook endpoint secret rotated if it is older than 90 days
                - [ ] Release notes posted in #payments

                | Check | Where |
                | --- | --- |
                | Error rate | Grafana → Payments overview |
                | Webhook lag | `payment_events` older than 1 minute |
                """,
            Comments:
            [
                new(8, "maya", _ => "Added this to the release template, thanks Tomasz."),
            ]),
    ]);

    private static DemoDocTree WebApp() => new("WEB",
    [
        Folder("web-design", "Design system", "sofia", 50),
        Folder("web-checkout", "Checkout", "sofia", 38),
        new("web-tokens", DocKind.Page, "Colour tokens and dark mode", "web-design", "sofia", 47,
            r => $$"""
                All colours come from tokens, so the dark theme is a second set of values rather than a second stylesheet ({{r.Ticket("Introduce colour tokens for light and dark themes")}}).

                | Token | Light | Dark | Used for |
                | --- | --- | --- | --- |
                | `--surface` | `#ffffff` | `#1b1d21` | Cards, dialogs |
                | `--text` | `#1f2328` | `#e6e8eb` | Body text |
                | `--accent` | `#2f6fed` | `#6c9cff` | Links, primary buttons |
                | `--danger` | `#c62828` | `#ff6b6b` | Errors |

                ```scss
                .price {
                  color: var(--text);
                  background: var(--surface);
                }
                ```

                > [!TIP]
                > Charts read their colours from the same tokens; that fixed {{r.Ticket("Charts are unreadable in dark mode")}}.
                """,
            Revisions:
            [
                new(25, "maya", "Accent is the focus ring colour too", (_, text) => text.Replace(
                    "| `--accent` | `#2f6fed` | `#6c9cff` | Links, primary buttons |",
                    "| `--accent` | `#2f6fed` | `#6c9cff` | Links, primary buttons, focus rings |", StringComparison.Ordinal)),
            ]),
        new("web-a11y", DocKind.Page, "Accessibility checklist", "web-design", "priya", 33,
            r => $$"""
                Every new screen goes through this list before review (WCAG 2.2 AA).

                - [ ] Everything works with the keyboard alone, in a sensible order
                - [ ] Focus is visible on every interactive element ({{r.Ticket("Visible focus styles for all interactive elements")}})
                - [ ] Icon-only buttons have a label
                - [ ] Dialogs trap focus and return it on close ({{r.Ticket("Modal dialogs do not trap focus")}})
                - [ ] Errors are announced ({{r.Ticket("Error messages are not announced by screen readers")}})

                > [!CAUTION]
                > Colour alone never carries meaning: a red border needs an icon or text too.
                """,
            Comments:
            [
                new(20, "tomasz", r => $"I use this list for the manual test cases as well. Could we add the 320 px check from {r.Ticket("Footer links overlap on 320 px screens")}?"),
            ]),
        new("web-steps", DocKind.Diagram, "Checkout steps", "web-checkout", "sofia", 36,
            _ => """
                stateDiagram-v2
                  [*] --> Cart
                  Cart --> Address: Checkout
                  Address --> Payment: Continue
                  Payment --> ThreeDS: Bank asks for 3-D Secure
                  ThreeDS --> Confirmation: Approved
                  ThreeDS --> Payment: Declined
                  Payment --> Confirmation: Paid
                  Confirmation --> [*]
                """,
            DiagramFormat.Mermaid),
        new("web-wireframe", DocKind.Diagram, "Checkout wireframe", "web-checkout", "sofia", 35,
            Format: DiagramFormat.Canvas,
            Canvas: new DemoCanvas()
                .Box("address", 0, 0, "1 Address", "#a5d8ff")
                .Box("delivery", 0, 120, "2 Delivery", "#a5d8ff")
                .Box("payment", 0, 240, "3 Payment", "#a5d8ff")
                .Box("summary", 320, 0, "Order summary", "#ffec99")
                .Box("pay", 320, 240, "Pay button", "#b2f2bb")
                .Arrow("address", "delivery")
                .Arrow("delivery", "payment")
                .Arrow("payment", "pay", "enabled when valid")),
        new("web-checkout-overview", DocKind.Page, "Checkout redesign", "web-checkout", "sofia", 34,
            r => $$"""
                The new checkout fits on one page: address, delivery and payment as steps on the left, the order summary sticky on the right ({{r.Ticket("Single-page checkout layout")}}).

                ![Checkout wireframe]({{r.Doc("web-wireframe")}})

                > [!NOTE]
                > The redesign runs behind the `checkout.new-layout` flag at 25 % while {{r.Ticket("A/B test the new checkout against the current one")}} collects data.

                ## States

                ![Checkout steps]({{r.Doc("web-steps")}})

                The 3-D Secure step is owned by Payments ({{r.Ticket("Handle the 3-D Secure challenge in the checkout flow")}}); the web side only shows the modal ({{r.Ticket("Integrate the 3-D Secure challenge modal")}}).

                | Metric | Old checkout | Target |
                | --- | --- | --- |
                | Conversion | 2.9 % | 3.3 % |
                | Time to pay (median) | 94 s | 60 s |
                """,
            Revisions:
            [
                new(16, "priya", "Add the A/B test targets", (_, text) => text.Replace(
                    "| Time to pay (median) | 94 s | 60 s |",
                    "| Time to pay (median) | 94 s | 60 s |\n| Errors per 100 checkouts | 4.1 | under 2 |", StringComparison.Ordinal)),
                new(6, "sofia", "Describe the summary on phones", (r, text) => text + $$"""


                    > [!TIP]
                    > On phones the summary collapses into a bar above the Pay button; see {{r.Ticket("Sticky order summary on desktop")}} for the desktop behaviour.
                    """),
            ],
            Comments:
            [
                new(15, "maya", _ => "Payments is fine with owning the 3-D Secure step. We will keep the modal API stable."),
                new(13, "priya", _ => "First A/B numbers next Friday."),
            ]),
        new("web-perf", DocKind.Page, "Performance budget", null, "daniel", 22,
            r => $$"""
                Budgets are checked on every pull request by Lighthouse CI ({{r.Ticket("Add Lighthouse CI with budgets")}}).

                | Metric | Budget | Today |
                | --- | --- | --- |
                | Main bundle (gzip) | 300 kB | 341 kB |
                | Largest Contentful Paint | 2.5 s | 2.1 s |
                | Cumulative Layout Shift | 0.1 | 0.14 |

                > [!WARNING]
                > The main bundle is over budget ({{r.Ticket("Main bundle exceeds the 300 kB budget")}}). New dependencies need a lazy route or a replacement for something we drop.

                ```json
                { "resourceSizes": [{ "resourceType": "script", "budget": 300 }] }
                ```
                """),
    ]);

    private static DemoDocTree PlatformOps() => new("OPS",
    [
        Folder("ops-runbooks", "Runbooks", "lucas", 70),
        Folder("ops-architecture", "Architecture", "lucas", 66),
        new("ops-timeline", DocKind.Diagram, "PostgreSQL 18 upgrade timeline", "ops-runbooks", "lucas", 45,
            _ => """
                gantt
                  title PostgreSQL 18 upgrade
                  dateFormat YYYY-MM-DD
                  section Staging
                  Upgrade staging cluster      :done, s1, 2026-08-24, 3d
                  Load test                    :done, s2, after s1, 4d
                  section Production
                  Rehearse on a snapshot       :active, p1, 2026-09-14, 5d
                  Maintenance window           :milestone, p2, 2026-10-03, 0d
                """,
            DiagramFormat.Mermaid),
        new("ops-upgrade", DocKind.Page, "PostgreSQL 18 upgrade runbook", "ops-runbooks", "lucas", 44,
            r => $$"""
                In-place upgrade with `pg_upgrade --link` during the Saturday maintenance window. Rehearsed on a production snapshot first ({{r.Ticket("Rehearse pg_upgrade on a production snapshot")}}).

                ![PostgreSQL 18 upgrade timeline]({{r.Doc("ops-timeline")}})

                > [!CAUTION]
                > With `--link` the old cluster cannot be started once the new one has run. The way back is the rollback runbook ({{r.Ticket("Write the rollback runbook")}}), which restores from the snapshot.

                ## Steps

                ```bash
                systemctl stop pgbouncer
                pg_upgradecluster --method=link 17 main
                vacuumdb --all --analyze-in-stages
                systemctl start pgbouncer
                ```

                | Step | Expected duration |
                | --- | --- |
                | Stop traffic | 2 min |
                | `pg_upgrade --link` | 6 min |
                | Analyze | 25 min (runs with traffic back on) |
                """,
            Revisions:
            [
                new(18, "daniel", "Add PgBouncer pool settings", (r, text) => text + $$"""


                    ## After the upgrade

                    Raise `default_pool_size` back to 40 ({{r.Ticket("Tune connection pool settings for PgBouncer")}}) once the analyze has finished.
                    """),
            ],
            Comments:
            [
                new(17, "maya", _ => "Payments can live with 10 minutes of downtime on Saturday morning. Please post in #payments-oncall before you start."),
            ]),
        new("ops-oncall", DocKind.Page, "On-call handbook", "ops-runbooks", "lucas", 30,
            r => $$"""
                The escalation policy behind this page is {{r.Ticket("On-call handbook: escalation policy")}}.

                | Severity | Example | Respond within | Escalate to |
                | --- | --- | --- | --- |
                | SEV1 | Checkout down | 5 min | Head of Engineering |
                | SEV2 | Payments degraded | 15 min | Team lead |
                | SEV3 | Single node unhealthy | Next working day | none |

                > [!IMPORTANT]
                > Certificates expiring within 14 days are a SEV2, as with {{r.Ticket("TLS certificate for api.example.com expires in 14 days")}}.
                """),
        new("ops-cluster", DocKind.Diagram, "Cluster overview", "ops-architecture", "daniel", 28,
            Format: DiagramFormat.Canvas,
            Canvas: new DemoCanvas()
                .Box("lb", 0, 90, "Load balancer", "#d0bfff")
                .Box("ingress", 300, 90, "ingress-nginx", "#a5d8ff")
                .Box("web", 600, 0, "web namespace", "#b2f2bb")
                .Box("payments", 600, 180, "payments namespace", "#b2f2bb")
                .Box("pg", 900, 180, "PostgreSQL 18", "#ffec99")
                .Arrow("lb", "ingress")
                .Arrow("ingress", "web")
                .Arrow("ingress", "payments")
                .Arrow("payments", "pg", "PgBouncer")),
        new("ops-topology", DocKind.Page, "Production topology", "ops-architecture", "daniel", 27,
            r => $$"""
                One Kubernetes cluster per region, one namespace per product area.

                ![Cluster overview]({{r.Doc("ops-cluster")}})

                | Namespace | Node pool | Notes |
                | --- | --- | --- |
                | `web` | general | Autoscaled 3–12 pods |
                | `payments` | general | PodDisruptionBudget 2 |
                | `search` | memory | Restarts after OOM: {{r.Ticket("Pod restarts in the search namespace after OOM")}} |

                > [!NOTE]
                > DNS lookups from `payments` go through NodeLocal DNSCache since {{r.Ticket("DNS resolution spikes in the payments namespace")}}.
                """,
            Comments:
            [
                new(10, "lucas", r => $"The batch node pool is missing; it matters for {r.Ticket("Autoscaler removes nodes running batch jobs")}."),
            ]),
        new("ops-dr", DocKind.Page, "Disaster recovery targets", "ops-architecture", "maya", 12,
            r => $$"""
                Agreed targets per service ({{r.Ticket("Document RTO and RPO per service")}}).

                | Service | RTO | RPO |
                | --- | --- | --- |
                | Checkout | 1 h | 5 min |
                | Payments database | 30 min | 1 min |
                | Search | 4 h | 24 h |

                > [!WARNING]
                > The payments database RTO depends on {{r.Ticket("Automate failover of the payments database")}}; until it ships the failover is manual and takes about 45 minutes.
                """),
    ]);
}
