# ASCOMY Benchmark Notes (Competitive Reference)

## Scope

This note captures practical competitor signals from publicly available ASCOMY pages to guide parity decisions for Israel routing workflows.

## Observed Capabilities

From `ascomy.com/the-product` and `ascomy.com/faq`:

- Cloud route optimization for multi-stop distribution
- Customer time-window constraints
- Driver/truck planning with capability matching
- Static routing support (force order/task to route)
- Real-time dashboard and live activity reporting
- Dynamic insertion of tasks after route start
- Manual route edits on map
- Alerts/notifications for skipped deliveries and route events
- Route policy controls (toll roads, U-turns, dead-end handling)
- Support for non-return-to-depot end location
- Onboarding from Excel-based data import

## Product Implications For Geograf

Minimum parity checklist:
1. Start-city-first route generation
2. Vehicle/customer capability constraints
3. Dynamic add-stop handling
4. Manual dispatcher override
5. Alerting for route anomalies
6. Operational policy toggles (toll/turn/road class)

Differentiation opportunities:
- Better Hebrew address normalization and geocode confidence scoring
- Israel-specific closure awareness and fallback behavior
- SQL-native integration (no Excel dependency for primary flow)
- Deterministic `סדר ביקור` with traceable tie-breakers

## Source Links

- https://ascomy.com/the-product/
- https://ascomy.com/faq/

