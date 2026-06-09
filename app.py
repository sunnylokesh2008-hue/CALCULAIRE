import os
import psycopg2
import razorpay
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv
from flask import session, redirect, url_for

load_dotenv()
conn = psycopg2.connect(
    dbname=os.getenv("DB_NAME"),
    user=os.getenv("DB_USER"),
    password=os.getenv("DB_PASSWORD"),
    host=os.getenv("DB_HOST"),
    port=os.getenv("DB_PORT")
)

print("DATABASE CONNECTED")
def save_payment(payment_id, order_id, amount, expression, result,mode):
    cur = conn.cursor()
    cur.execute("""
INSERT INTO payments
(payment_id, order_id, amount, expression, result, mode)
VALUES (%s, %s, %s, %s, %s, %s)
""", (
    payment_id,
    order_id,
    amount,
    expression,
    result,
    mode
))


    conn.commit()
    cur.close()
app = Flask(__name__)
app.secret_key = "calculaire_super_secret_key"

RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET")

client = razorpay.Client(
    auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)
)

@app.route("/")
def home():
    return render_template("index.html")


@app.route("/test-keys")
def test_keys():
    return jsonify({
        "loaded": bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET)
    })


@app.route("/create-order")
def create_order():

    amount = int(request.args.get("amount", 1))

    if amount < 1:
        amount = 1

    order = client.order.create({
        "amount": amount * 100,
        "currency": "INR"
    })

    return jsonify({
        "order_id": order["id"],
        "amount": order["amount"],
        "key": RAZORPAY_KEY_ID
    })

@app.route("/verify-payment", methods=["POST"])
def verify_payment():

    data = request.json

    try:

        client.utility.verify_payment_signature({
            "razorpay_order_id": data["order_id"],
            "razorpay_payment_id": data["payment_id"],
            "razorpay_signature": data["signature"]
        })

        save_payment(
            data["payment_id"],
            data["order_id"],
            data["amount"],
            data["expression"],
            data["result"],
            data["mode"]
        )

        return jsonify({
            "verified": True
        })

    except Exception as e:

        print("Verification Error:", e)

        return jsonify({
            "verified": False
        }), 400

@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():

    if request.method == "POST":

        username = request.form.get("username")
        password = request.form.get("password")

        if (
            username == os.getenv("ADMIN_USERNAME")
            and
            password == os.getenv("ADMIN_PASSWORD")
        ):
            session["admin"] = True
            return redirect("/admin/dashboard")

    return render_template("admin_login.html")

@app.route("/admin/dashboard")
def admin_dashboard():

    if not session.get("admin"):
        return redirect("/admin/login")

    cur = conn.cursor()

    # Total payments count
    cur.execute("SELECT COUNT(*) FROM payments")
    total_payments = cur.fetchone()[0]

    # Total revenue
    cur.execute("SELECT COALESCE(SUM(amount), 0) FROM payments")
    total_revenue = cur.fetchone()[0]

    # Recent transactions
    cur.execute("""
        SELECT
            payment_id,
            amount,
            mode,
            created_at
        FROM payments
        ORDER BY id DESC
        LIMIT 10
    """)

    recent_payments = cur.fetchall()

    cur.close()

    return render_template(
        "admin_dashboard.html",
        total_payments=total_payments,
        total_revenue=total_revenue,
        recent_payments=recent_payments
    )
@app.route("/admin/logout")
def admin_logout():

    session.clear()

    return redirect("/")

if __name__ == "__main__":
    app.run(debug=True)