import json
import math
import os
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from email.message import EmailMessage
from functools import wraps

import psycopg2
import psycopg2.extras
import razorpay
from dotenv import load_dotenv
from flask import Flask, g, jsonify, redirect, render_template, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from calculator_engine import CalculationError, build_insight, calculate, format_result

load_dotenv()

PACKAGE_CATALOG = {
    "tables": {
        "name": "Tables Package",
        "price": 20,
        "description": "Tables 1-100 with search and practice.",
    },
    "squares": {
        "name": "Squares Package",
        "price": 20,
        "description": "Squares, cubes, square roots, cube roots, and quick lookup.",
    },
    "bundle": {
        "name": "Math Master Bundle",
        "price": 35,
        "description": "Lifetime access to Tables and Squares in one account-owned bundle.",
        "includes": ["tables", "squares"],
    },
}

MIN_RESULT_UNLOCK_AMOUNT = 2
OTP_TTL_MINUTES = 10
CALCULATION_TTL_MINUTES = 30
ALLOWED_THEMES = {"dark", "light", "gold"}


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def connect_db():
    connection = psycopg2.connect(
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        host=os.getenv("DB_HOST"),
        port=os.getenv("DB_PORT"),
    )
    connection.autocommit = False
    return connection


app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY") or secrets.token_hex(32)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true",
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
)

RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET")

client = (
    razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
    if RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET
    else None
)


def get_db():
    if "db" not in g:
        g.db = connect_db()
    return g.db


@app.teardown_appcontext
def close_db(_error=None):
    connection = g.pop("db", None)
    if connection is not None:
        connection.close()


def db_cursor(dict_rows=False):
    cursor_factory = psycopg2.extras.RealDictCursor if dict_rows else None
    return get_db().cursor(cursor_factory=cursor_factory)


def csrf_token():
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_urlsafe(32)
    return session["csrf_token"]


def reset_session(**values):
    token = session.get("csrf_token")
    session.clear()
    session.update(values)
    session["csrf_token"] = token or secrets.token_urlsafe(32)
    session.permanent = bool(values)


@app.before_request
def protect_state_changes():
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        supplied = request.headers.get("X-CSRF-Token") or request.form.get("csrf_token")
        if not supplied or not secrets.compare_digest(supplied, csrf_token()):
            if request.path.startswith("/admin/"):
                return "Invalid request token.", 400
            return jsonify({"ok": False, "error": "Your session expired. Refresh and try again."}), 400


@app.after_request
def set_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    return response


def ensure_schema():
    cur = db_cursor()

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            is_verified BOOLEAN NOT NULL DEFAULT FALSE,
            otp_hash TEXT,
            otp_purpose TEXT,
            otp_expires_at TIMESTAMP,
            theme TEXT NOT NULL DEFAULT 'dark',
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS payments (
            id SERIAL PRIMARY KEY,
            payment_id TEXT UNIQUE,
            order_id TEXT,
            amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
            expression TEXT,
            result TEXT,
            mode TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE")
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_hash TEXT")
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_purpose TEXT")
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMP")
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'dark'")

    cur.execute("ALTER TABLE payments ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL")
    cur.execute("ALTER TABLE payments ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'result_unlock'")
    cur.execute("ALTER TABLE payments ADD COLUMN IF NOT EXISTS package_code TEXT")
    cur.execute("ALTER TABLE payments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'verified'")
    cur.execute("ALTER TABLE payments ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb")
    cur.execute("ALTER TABLE payments ADD COLUMN IF NOT EXISTS calculation_id TEXT")
    cur.execute(
        """
        DELETE FROM payments newer
        USING payments older
        WHERE newer.payment_id IS NOT NULL
          AND newer.payment_id = older.payment_id
          AND newer.id > older.id
        """
    )
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_payment_id ON payments(payment_id)")

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS package_ownership (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            package_code TEXT NOT NULL,
            payment_id TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, package_code)
        )
        """
    )
    cur.execute(
        """
        DELETE FROM package_ownership newer
        USING package_ownership older
        WHERE newer.user_id = older.user_id
          AND newer.package_code = older.package_code
          AND newer.id > older.id
        """
    )
    cur.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_package_ownership_user_code ON package_ownership(user_id, package_code)"
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS calculation_history (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expression TEXT NOT NULL,
            result TEXT NOT NULL,
            mode TEXT NOT NULL,
            insight JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS pending_calculations (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expression TEXT NOT NULL,
            result TEXT NOT NULL,
            mode TEXT NOT NULL,
            angle TEXT NOT NULL,
            insight JSONB NOT NULL DEFAULT '{}'::jsonb,
            status TEXT NOT NULL DEFAULT 'pending',
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            unlocked_at TIMESTAMP
        )
        """
    )

    get_db().commit()
    cur.close()


with app.app_context():
    try:
        # Only attempt DB schema setup when connection info is present
        if os.getenv("DB_NAME") and os.getenv("DB_USER"):
            ensure_schema()
            print("DATABASE CONNECTED")
        else:
            print("DATABASE SKIPPED: DB environment not configured")
    except Exception as exc:
        # Fail gracefully in development when DB is unavailable; log and continue
        print("DATABASE ERROR (schema setup skipped):", exc)


def as_float(value):
    if isinstance(value, Decimal):
        return float(value)
    return value


def public_user(user):
    if not user:
        return None
    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "is_verified": user["is_verified"],
        "theme": user["theme"],
    }


def fetch_current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    cur = db_cursor(dict_rows=True)
    cur.execute(
        """
        SELECT id, name, email, is_verified, theme, created_at
        FROM users
        WHERE id = %s
        """,
        (user_id,),
    )
    user = cur.fetchone()
    cur.close()
    return user


def get_owned_packages(user_id):
    if not user_id:
        return []
    cur = db_cursor()
    cur.execute(
        """
        SELECT package_code
        FROM package_ownership
        WHERE user_id = %s
        """,
        (user_id,),
    )
    packages = [row[0] for row in cur.fetchall()]
    cur.close()
    return packages


def login_required_json(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("user_id"):
            return jsonify({"ok": False, "error": "Login required."}), 401
        return fn(*args, **kwargs)

    return wrapper


def verified_user_or_error():
    user = fetch_current_user()
    if not user:
        return None, (jsonify({"ok": False, "error": "Login required."}), 401)
    if not user["is_verified"]:
        return None, (jsonify({"ok": False, "error": "Email verification required."}), 403)
    return user, None


def generate_otp():
    return f"{secrets.randbelow(900000) + 100000}"


def store_otp(user_id, otp, purpose):
    cur = db_cursor()
    cur.execute(
        """
        UPDATE users
        SET otp_hash = %s,
            otp_purpose = %s,
            otp_expires_at = %s
        WHERE id = %s
        """,
        (
            generate_password_hash(otp),
            purpose,
            utcnow() + timedelta(minutes=OTP_TTL_MINUTES),
            user_id,
        ),
    )
    get_db().commit()
    cur.close()


def send_otp_email(email, otp, purpose):
    subject = "CALCULAIRE verification code"
    label = "verify your email" if purpose == "verify" else "reset your password"
    body = (
        f"Your CALCULAIRE Elite code is {otp}.\n\n"
        f"Use it within {OTP_TTL_MINUTES} minutes to {label}."
    )

    smtp_host = os.getenv("SMTP_HOST")
    if not smtp_host:
        # SMTP not configured in this environment; do not print sensitive OTP to logs.
        print(f"OTP delivery skipped (SMTP not configured) for {email}")
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = os.getenv("SMTP_FROM", os.getenv("SMTP_USER"))
    msg["To"] = email
    msg.set_content(body)

    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_password = os.getenv("SMTP_PASSWORD")

    with smtplib.SMTP(smtp_host, smtp_port) as smtp:
        smtp.starttls()
        if smtp_user and smtp_password:
            smtp.login(smtp_user, smtp_password)
        smtp.send_message(msg)
    return True


def issue_otp(user_id, email, purpose, expose_dev=False):
    otp = generate_otp()
    store_otp(user_id, otp, purpose)
    delivered = send_otp_email(email, otp, purpose)
    payload = {"sent": delivered}
    # Do not include development OTPs in responses to avoid leaking codes.
    return payload


def save_payment(payment_id, order_id, amount, expression, result, mode, purpose, package_code, user_id, metadata, calculation_id=None):
    cur = db_cursor()
    cur.execute(
        """
        INSERT INTO payments
            (payment_id, order_id, amount, expression, result, mode, purpose, package_code, user_id, status, metadata, calculation_id)
        VALUES
            (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'verified', %s::jsonb, %s)
        ON CONFLICT (payment_id) DO NOTHING
        """,
        (
            payment_id,
            order_id,
            amount,
            expression,
            result,
            mode,
            purpose,
            package_code,
            user_id,
            json.dumps(metadata or {}),
            calculation_id,
        ),
    )

    if purpose == "package" and package_code and user_id:
        granted_codes = [package_code] + PACKAGE_CATALOG.get(package_code, {}).get("includes", [])
        for granted_code in granted_codes:
            cur.execute(
                """
                INSERT INTO package_ownership (user_id, package_code, payment_id)
                VALUES (%s, %s, %s)
                ON CONFLICT (user_id, package_code) DO NOTHING
                """,
                (user_id, granted_code, payment_id),
            )

    get_db().commit()
    cur.close()


@app.route("/")
def home():
    user = fetch_current_user()
    owned_packages = get_owned_packages(user["id"]) if user else []
    return render_template(
        "index.html",
        current_user=public_user(user),
        owned_packages=owned_packages,
        package_catalog=PACKAGE_CATALOG,
        min_result_amount=MIN_RESULT_UNLOCK_AMOUNT,
        csrf_token=csrf_token(),
    )


@app.route("/health")
def health():
    return jsonify({"ok": True, "payments_configured": bool(client)})


@app.route("/auth/register", methods=["POST"])
def register():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if len(name) < 2:
        return jsonify({"ok": False, "error": "Enter your name."}), 400
    if "@" not in email or "." not in email:
        return jsonify({"ok": False, "error": "Enter a valid email."}), 400
    if len(password) < 8:
        return jsonify({"ok": False, "error": "Use at least 8 password characters."}), 400

    cur = db_cursor(dict_rows=True)
    try:
        cur.execute(
            """
            INSERT INTO users (name, email, password_hash)
            VALUES (%s, %s, %s)
            RETURNING id, name, email, is_verified, theme
            """,
            (name, email, generate_password_hash(password)),
        )
        user = cur.fetchone()
        get_db().commit()
    except psycopg2.errors.UniqueViolation:
        get_db().rollback()
        cur.execute(
            """
            SELECT id, name, email, is_verified, theme
            FROM users
            WHERE email = %s
            """,
            (email,),
        )
        existing = cur.fetchone()
        cur.close()
        if existing and not existing["is_verified"]:
            reset_session(user_id=existing["id"])
            otp_payload = issue_otp(existing["id"], existing["email"], "verify", expose_dev=True)
            return jsonify({"ok": True, "user": public_user(existing), "otp": otp_payload})
        return jsonify({"ok": False, "error": "An account already exists for this email."}), 409

    cur.close()
    reset_session(user_id=user["id"])
    otp_payload = issue_otp(user["id"], user["email"], "verify", expose_dev=True)
    return jsonify({"ok": True, "user": public_user(user), "otp": otp_payload})


@app.route("/auth/login", methods=["POST"])
def login():
    data = request.get_json(force=True)
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    cur = db_cursor(dict_rows=True)
    cur.execute(
        """
        SELECT id, name, email, password_hash, is_verified, theme
        FROM users
        WHERE email = %s
        """,
        (email,),
    )
    user = cur.fetchone()
    cur.close()

    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"ok": False, "error": "Invalid email or password."}), 401

    reset_session(user_id=user["id"])
    return jsonify({"ok": True, "user": public_user(user), "owned_packages": get_owned_packages(user["id"])})


@app.route("/auth/logout", methods=["POST"])
def logout():
    reset_session()
    return jsonify({"ok": True})


@app.route("/auth/resend-otp", methods=["POST"])
@login_required_json
def resend_otp():
    user = fetch_current_user()
    if user["is_verified"]:
        return jsonify({"ok": True, "message": "Account is already verified."})
    last_sent = session.get("otp_sent_at", 0)
    if utcnow().timestamp() - last_sent < 30:
        return jsonify({"ok": False, "error": "Wait 30 seconds before requesting another code."}), 429
    session["otp_sent_at"] = utcnow().timestamp()
    return jsonify({"ok": True, "otp": issue_otp(user["id"], user["email"], "verify", expose_dev=True)})


@app.route("/auth/verify-otp", methods=["POST"])
@login_required_json
def verify_otp():
    data = request.get_json(force=True)
    otp = (data.get("otp") or "").strip()
    user_id = session["user_id"]

    cur = db_cursor(dict_rows=True)
    cur.execute(
        """
        SELECT id, name, email, is_verified, theme, otp_hash, otp_purpose, otp_expires_at
        FROM users
        WHERE id = %s
        """,
        (user_id,),
    )
    user = cur.fetchone()

    if not user or user["otp_purpose"] != "verify" or not user["otp_hash"]:
        cur.close()
        return jsonify({"ok": False, "error": "No verification code is active."}), 400
    if user["otp_expires_at"] and user["otp_expires_at"] < utcnow():
        cur.close()
        return jsonify({"ok": False, "error": "Verification code expired."}), 400
    if not check_password_hash(user["otp_hash"], otp):
        cur.close()
        return jsonify({"ok": False, "error": "Invalid verification code."}), 400

    cur.execute(
        """
        UPDATE users
        SET is_verified = TRUE,
            otp_hash = NULL,
            otp_purpose = NULL,
            otp_expires_at = NULL
        WHERE id = %s
        RETURNING id, name, email, is_verified, theme
        """,
        (user_id,),
    )
    verified_user = cur.fetchone()
    get_db().commit()
    cur.close()
    return jsonify({"ok": True, "user": public_user(verified_user)})


@app.route("/auth/request-reset", methods=["POST"])
def request_reset():
    data = request.get_json(force=True)
    email = (data.get("email") or "").strip().lower()

    cur = db_cursor(dict_rows=True)
    cur.execute(
        """
        SELECT id, email
        FROM users
        WHERE email = %s
        """,
        (email,),
    )
    user = cur.fetchone()
    cur.close()

    if not user:
        return jsonify({"ok": True, "message": "If the account exists, a reset code was sent."})

    issue_otp(user["id"], user["email"], "reset", expose_dev=False)
    return jsonify({"ok": True, "message": "If the account exists, a reset code was sent."})


@app.route("/auth/reset-password", methods=["POST"])
def reset_password():
    data = request.get_json(force=True)
    email = (data.get("email") or "").strip().lower()
    otp = (data.get("otp") or "").strip()
    password = data.get("password") or ""

    if len(password) < 8:
        return jsonify({"ok": False, "error": "Use at least 8 password characters."}), 400

    cur = db_cursor(dict_rows=True)
    cur.execute(
        """
        SELECT id, otp_hash, otp_purpose, otp_expires_at
        FROM users
        WHERE email = %s
        """,
        (email,),
    )
    user = cur.fetchone()

    if (
        not user
        or user["otp_purpose"] != "reset"
        or not user["otp_hash"]
        or (user["otp_expires_at"] and user["otp_expires_at"] < utcnow())
        or not check_password_hash(user["otp_hash"], otp)
    ):
        cur.close()
        return jsonify({"ok": False, "error": "Invalid or expired reset code."}), 400

    cur.execute(
        """
        UPDATE users
        SET password_hash = %s,
            otp_hash = NULL,
            otp_purpose = NULL,
            otp_expires_at = NULL
        WHERE id = %s
        """,
        (generate_password_hash(password), user["id"]),
    )
    get_db().commit()
    cur.close()
    return jsonify({"ok": True})


@app.route("/api/theme", methods=["POST"])
@login_required_json
def save_theme():
    data = request.get_json(force=True)
    theme = data.get("theme")
    if theme not in ALLOWED_THEMES:
        return jsonify({"ok": False, "error": "Invalid theme."}), 400

    cur = db_cursor()
    cur.execute("UPDATE users SET theme = %s WHERE id = %s", (theme, session["user_id"]))
    get_db().commit()
    cur.close()
    return jsonify({"ok": True})


@app.route("/api/history")
@login_required_json
def history():
    search = (request.args.get("q") or "").strip()[:80]
    cur = db_cursor(dict_rows=True)
    cur.execute(
        """
        SELECT expression, result, mode, insight, created_at
        FROM calculation_history
        WHERE user_id = %s
          AND (%s = '' OR expression ILIKE '%%' || %s || '%%' OR result ILIKE '%%' || %s || '%%')
        ORDER BY id DESC
        LIMIT 50
        """,
        (session["user_id"], search, search, search),
    )
    rows = cur.fetchall()
    cur.close()
    return jsonify({"ok": True, "history": rows})


@app.route("/api/calculations", methods=["POST"])
def create_calculation():
    user = fetch_current_user()  # Optional - guests don't need to be logged in
    
    data = request.get_json(force=True)
    expression = (data.get("expression") or "").strip()
    mode = data.get("mode") if data.get("mode") in {"standard", "scientific"} else "standard"
    angle = data.get("angle") if data.get("angle") in {"deg", "rad"} else "deg"

    try:
        numeric_result = calculate(expression, angle)
        result = format_result(numeric_result)
        insight = build_insight(expression, numeric_result, mode, angle)
    except CalculationError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    calculation_id = secrets.token_urlsafe(24)
    
    # Store in database only if user is logged in (for history retention)
    if user and user.get("is_verified"):
        cur = db_cursor()
        cur.execute(
            """
            INSERT INTO pending_calculations
                (id, user_id, expression, result, mode, angle, insight, expires_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s)
            """,
            (
                calculation_id,
                user["id"],
                expression,
                result,
                mode,
                angle,
                json.dumps(insight),
                utcnow() + timedelta(minutes=CALCULATION_TTL_MINUTES),
            ),
        )
        get_db().commit()
        cur.close()
    
    return jsonify({
        "ok": True,
        "calculation_id": calculation_id,
        "expression": expression,
        "result": result,
        "insight": insight,
        "mode": mode,
        "expires_in": CALCULATION_TTL_MINUTES * 60,
    })


@app.route("/api/library/<package_code>")
@login_required_json
def library_package(package_code):
    user, error = verified_user_or_error()
    if error:
        return error
    if package_code not in {"tables", "squares"}:
        return jsonify({"ok": False, "error": "Unknown package."}), 404
    if package_code not in get_owned_packages(user["id"]):
        return jsonify({"ok": False, "error": "Purchase required."}), 403

    if package_code == "tables":
        items = [
            {"n": n, "values": [n * multiplier for multiplier in range(1, 11)]}
            for n in range(1, 101)
        ]
    else:
        items = [
            {
                "n": n,
                "square": n * n,
                "cube": n * n * n,
                "square_root": round(math.sqrt(n), 8),
                "cube_root": round(n ** (1 / 3), 8),
            }
            for n in range(1, 1001)
        ]

    return jsonify({"ok": True, "package": package_code, "items": items})


@app.route("/api/purchases")
@login_required_json
def purchases():
    cur = db_cursor(dict_rows=True)
    cur.execute(
        """
        SELECT package_code, payment_id, created_at
        FROM package_ownership
        WHERE user_id = %s
        ORDER BY created_at DESC
        """,
        (session["user_id"],),
    )
    rows = cur.fetchall()
    cur.close()
    return jsonify({"ok": True, "purchases": rows})


@app.route("/create-order", methods=["POST"])
@login_required_json
def create_order():
    if not client:
        return jsonify({"ok": False, "error": "Payments are not configured."}), 503

    user, error = verified_user_or_error()
    if error:
        return error

    data = request.get_json(force=True)
    purpose = data.get("purpose", "result_unlock")
    package_code = data.get("package")
    calculation_id = data.get("calculation_id")

    if purpose == "package":
        if package_code not in PACKAGE_CATALOG:
            return jsonify({"ok": False, "error": "Unknown package."}), 400
        if package_code in get_owned_packages(user["id"]):
            return jsonify({"ok": False, "error": "Package already owned."}), 409
        amount = PACKAGE_CATALOG[package_code]["price"]
    else:
        cur = db_cursor(dict_rows=True)
        cur.execute(
            """
            SELECT id
            FROM pending_calculations
            WHERE id = %s AND user_id = %s AND status = 'pending' AND expires_at > %s
            """,
            (calculation_id, user["id"], utcnow()),
        )
        pending = cur.fetchone()
        cur.close()
        if not pending:
            return jsonify({"ok": False, "error": "Calculation expired. Compute it again."}), 404
        try:
            amount = int(float(data.get("amount", MIN_RESULT_UNLOCK_AMOUNT)))
        except (TypeError, ValueError):
            amount = MIN_RESULT_UNLOCK_AMOUNT
        amount = min(max(amount, MIN_RESULT_UNLOCK_AMOUNT), 100000)
        purpose = "result_unlock"
        package_code = None

    order = client.order.create(
        {
            "amount": amount * 100,
            "currency": "INR",
            "notes": {
                "purpose": purpose,
                "package_code": package_code or "",
                "user_id": str(user["id"]),
                "calculation_id": calculation_id or "",
            },
        }
    )

    return jsonify(
        {
            "ok": True,
            "order_id": order["id"],
            "amount": order["amount"],
            "key": RAZORPAY_KEY_ID,
            "purpose": purpose,
            "package": package_code,
            "calculation_id": calculation_id,
        }
    )


@app.route("/verify-payment", methods=["POST"])
def verify_payment():
    if not client:
        return jsonify({"verified": False, "error": "Payments are not configured."}), 503

    user, error = verified_user_or_error()
    if error:
        return error

    data = request.get_json(force=True)

    try:
        client.utility.verify_payment_signature(
            {
                "razorpay_order_id": data["order_id"],
                "razorpay_payment_id": data["payment_id"],
                "razorpay_signature": data["signature"],
            }
        )

        order = client.order.fetch(data["order_id"])
        payment = client.payment.fetch(data["payment_id"])
        notes = order.get("notes") or {}
        purpose = notes.get("purpose") or "result_unlock"
        package_code = notes.get("package_code") or None
        calculation_id = notes.get("calculation_id") or None
        amount = Decimal(order["amount"]) / Decimal(100)

        if str(notes.get("user_id")) != str(user["id"]):
            return jsonify({"verified": False, "error": "Order owner mismatch."}), 403
        if payment.get("order_id") != data["order_id"]:
            return jsonify({"verified": False, "error": "Payment order mismatch."}), 400
        if payment.get("currency") != "INR" or Decimal(payment.get("amount", 0)) != Decimal(order["amount"]):
            return jsonify({"verified": False, "error": "Payment amount mismatch."}), 400
        if payment.get("status") != "captured":
            return jsonify({"verified": False, "error": "Payment has not been captured."}), 400

        if purpose == "package":
            expected_amount = PACKAGE_CATALOG.get(package_code, {}).get("price")
            if not expected_amount or amount != Decimal(expected_amount):
                return jsonify({"verified": False, "error": "Payment amount mismatch."}), 400
            expression = result = mode = None
            insight = None
        else:
            if amount < Decimal(MIN_RESULT_UNLOCK_AMOUNT):
                return jsonify({"verified": False, "error": "Minimum unlock amount is Rs. 2."}), 400
            cur = db_cursor(dict_rows=True)
            cur.execute(
                """
                SELECT expression, result, mode, angle, insight, status, expires_at
                FROM pending_calculations
                WHERE id = %s AND user_id = %s
                FOR UPDATE
                """,
                (calculation_id, user["id"]),
            )
            pending = cur.fetchone()
            if not pending or pending["expires_at"] < utcnow():
                cur.close()
                return jsonify({"verified": False, "error": "Calculation expired."}), 400
            expression = pending["expression"]
            result = pending["result"]
            mode = pending["mode"]
            insight = pending["insight"]
            cur.execute(
                """
                UPDATE pending_calculations
                SET status = 'unlocked', unlocked_at = CURRENT_TIMESTAMP
                WHERE id = %s
                """,
                (calculation_id,),
            )
            if pending["status"] != "unlocked":
                cur.execute(
                    """
                    INSERT INTO calculation_history (user_id, expression, result, mode, insight)
                    VALUES (%s, %s, %s, %s, %s::jsonb)
                    """,
                    (user["id"], expression, result, mode, json.dumps(insight)),
                )
            cur.close()

        save_payment(
            data["payment_id"],
            data["order_id"],
            amount,
            expression,
            result,
            mode,
            purpose,
            package_code,
            user["id"],
            {
                "razorpay_order_status": order.get("status"),
                "razorpay_payment_status": payment.get("status"),
                "verified_at": utcnow().isoformat(),
            },
            calculation_id,
        )

        payload = {"verified": True, "purpose": purpose, "package": package_code}
        if purpose == "result_unlock":
            payload.update({"result": result, "expression": expression, "mode": mode, "insight": insight})
        return jsonify(payload)

    except Exception as exc:
        print("Verification Error:", exc)
        get_db().rollback()
        return jsonify({"verified": False, "error": "Payment verification failed."}), 400


@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    error = None
    if request.method == "POST":
        username = request.form.get("username") or ""
        password = request.form.get("password") or ""
        expected_user = os.getenv("ADMIN_USERNAME") or ""
        expected_password = os.getenv("ADMIN_PASSWORD") or ""

        if expected_user and expected_password and secrets.compare_digest(username, expected_user) and secrets.compare_digest(password, expected_password):
            reset_session(admin=True)
            return redirect("/admin/dashboard")
        error = "Invalid administrator credentials."

    return render_template("admin_login.html", error=error, csrf_token=csrf_token())


@app.route("/admin/dashboard")
def admin_dashboard():
    if not session.get("admin"):
        return redirect("/admin/login")

    cur = db_cursor(dict_rows=True)

    cur.execute("SELECT COUNT(*) AS value FROM payments WHERE status = 'verified'")
    total_payments = cur.fetchone()["value"]

    cur.execute("SELECT COALESCE(SUM(amount), 0) AS value FROM payments WHERE status = 'verified'")
    total_revenue = as_float(cur.fetchone()["value"])

    cur.execute("SELECT COUNT(*) AS value FROM users")
    total_users = cur.fetchone()["value"]

    cur.execute(
        """
        SELECT COALESCE(SUM(amount), 0) AS value
        FROM payments
        WHERE status = 'verified' AND created_at::date = CURRENT_DATE
        """
    )
    daily_revenue = as_float(cur.fetchone()["value"])

    cur.execute(
        """
        SELECT COALESCE(SUM(amount), 0) AS value
        FROM payments
        WHERE status = 'verified'
          AND date_trunc('month', created_at) = date_trunc('month', CURRENT_DATE)
        """
    )
    monthly_revenue = as_float(cur.fetchone()["value"])

    cur.execute("SELECT COUNT(*) AS value FROM package_ownership WHERE package_code = 'tables'")
    tables_count = cur.fetchone()["value"]

    cur.execute("SELECT COUNT(*) AS value FROM package_ownership WHERE package_code = 'squares'")
    squares_count = cur.fetchone()["value"]

    cur.execute(
        """
        SELECT COALESCE(mode, 'standard') AS mode, COUNT(*) AS count
        FROM payments
        WHERE status = 'verified' AND mode IS NOT NULL
        GROUP BY mode
        ORDER BY count DESC
        LIMIT 1
        """
    )
    popular = cur.fetchone()
    popular_mode = popular["mode"] if popular else "standard"

    cur.execute(
        """
        SELECT day::date AS day, COALESCE(SUM(p.amount), 0) AS revenue
        FROM generate_series(CURRENT_DATE - INTERVAL '13 days', CURRENT_DATE, INTERVAL '1 day') AS day
        LEFT JOIN payments p
          ON p.created_at::date = day::date
         AND p.status = 'verified'
        GROUP BY day
        ORDER BY day
        """
    )
    revenue_rows = cur.fetchall()

    cur.execute(
        """
        SELECT day::date AS day, COUNT(u.id) AS users
        FROM generate_series(CURRENT_DATE - INTERVAL '13 days', CURRENT_DATE, INTERVAL '1 day') AS day
        LEFT JOIN users u
          ON u.created_at::date = day::date
        GROUP BY day
        ORDER BY day
        """
    )
    user_rows = cur.fetchall()

    cur.execute(
        """
        SELECT
            p.payment_id,
            p.amount,
            p.mode,
            p.purpose,
            p.package_code,
            p.created_at,
            u.email
        FROM payments p
        LEFT JOIN users u ON u.id = p.user_id
        ORDER BY p.id DESC
        LIMIT 10
        """
    )
    recent_payments = cur.fetchall()

    cur.execute(
        """
        SELECT name, email, is_verified, created_at
        FROM users
        ORDER BY id DESC
        LIMIT 8
        """
    )
    recent_users = cur.fetchall()

    cur.close()

    chart_labels = [row["day"].strftime("%b %d") for row in revenue_rows]
    revenue_chart = [as_float(row["revenue"]) for row in revenue_rows]
    user_growth_chart = [row["users"] for row in user_rows]

    return render_template(
        "admin_dashboard.html",
        total_payments=total_payments,
        total_revenue=total_revenue,
        total_users=total_users,
        daily_revenue=daily_revenue,
        monthly_revenue=monthly_revenue,
        tables_count=tables_count,
        squares_count=squares_count,
        popular_mode=popular_mode,
        chart_labels=chart_labels,
        revenue_chart=revenue_chart,
        user_growth_chart=user_growth_chart,
        recent_payments=recent_payments,
        recent_users=recent_users,
        csrf_token=csrf_token(),
    )


@app.route("/admin/logout", methods=["POST"])
def admin_logout():
    reset_session()
    return redirect("/")


if __name__ == "__main__":
    app.run(debug=True)
