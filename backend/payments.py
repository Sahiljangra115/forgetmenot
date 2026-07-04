"""Razorpay checkout: create an order, verify the signature Razorpay sends
back after the customer pays (cards + UPI both go through the same Checkout
widget, Razorpay decides the methods shown). Needs RAZORPAY_KEY_ID and
RAZORPAY_KEY_SECRET in the environment (test-mode keys are fine)."""

import os
import uuid

# Amount is looked up server-side from the plan key, never taken from the
# client, so a tampered request can't buy the Family plan for 1 paisa.
PLAN_PRICES_PAISE = {
    # Razorpay orders are in the smallest currency unit (paise for INR).
    # Razorpay's own minimum order amount is 100 paise (1 INR).
    "family": 1_200 * 100,
    "care_facility": None,  # contact sales, no self-serve checkout
}


class NotConfiguredError(RuntimeError):
    pass


_client = None


def _get_client():
    global _client
    if _client is not None:
        return _client
    key_id = os.getenv("RAZORPAY_KEY_ID")
    key_secret = os.getenv("RAZORPAY_KEY_SECRET")
    if not key_id or not key_secret:
        return None
    import razorpay
    _client = razorpay.Client(auth=(key_id, key_secret))
    return _client


def configured() -> bool:
    return _get_client() is not None


def create_order(plan: str, user_id: str) -> dict:
    amount = PLAN_PRICES_PAISE.get(plan)
    if not amount:
        raise ValueError(f"Plan '{plan}' has no self-serve checkout price.")
    if amount < 100:
        raise ValueError("Order amount must be at least 100 paise.")

    client = _get_client()
    if client is None:
        raise NotConfiguredError("Razorpay is not configured (missing RAZORPAY_KEY_ID/KEY_SECRET).")

    import razorpay
    try:
        order = client.order.create({
            "amount": amount,
            "currency": "INR",
            "receipt": f"fmn_{plan}_{uuid.uuid4().hex[:12]}",
            "notes": {"plan": plan, "user_id": user_id},
        })
    except razorpay.errors.BadRequestError as e:
        # Razorpay collapses both "bad params" and "bad/revoked API key"
        # into this same error class, so this is a 400, not a guessed 401.
        raise ValueError(f"Razorpay rejected the order request: {e}")
    except (razorpay.errors.ServerError, razorpay.errors.GatewayError) as e:
        raise RuntimeError(f"Razorpay order creation failed: {e}")

    return {
        "order_id": order["id"],
        "amount": amount,
        "currency": "INR",
        "key_id": os.getenv("RAZORPAY_KEY_ID"),
    }


def verify_payment(order_id: str, payment_id: str, signature: str) -> bool:
    if not order_id or not payment_id or not signature:
        raise ValueError("order_id, payment_id and signature are all required.")

    client = _get_client()
    if client is None:
        raise NotConfiguredError("Razorpay is not configured.")
    try:
        client.utility.verify_payment_signature({
            "razorpay_order_id": order_id,
            "razorpay_payment_id": payment_id,
            "razorpay_signature": signature,
        })
        return True
    except Exception:
        return False


def order_plan(order_id: str) -> str | None:
    """Look up the plan actually recorded on the order at creation time, so a
    signature-valid payment can't be replayed against a different plan."""
    client = _get_client()
    if client is None:
        raise NotConfiguredError("Razorpay is not configured.")
    order = client.order.fetch(order_id)
    return order.get("notes", {}).get("plan")
