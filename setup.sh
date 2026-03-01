#!/usr/bin/env bash
set -e

echo ""
echo "  ========================================"
echo "   Claude Telegram Bot - Setup"
echo "  ========================================"
echo ""

# ------- Check Node.js -------
if ! command -v node &>/dev/null; then
    echo "  [ERROR] Node.js is not installed."
    echo "  Please install Node.js 20+ from https://nodejs.org/"
    exit 1
fi
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 20 ]; then
    echo "  [ERROR] Node.js 20+ is required. Current: $(node -v)"
    exit 1
fi
echo "  [OK] Node.js $(node -v)"

# ------- Check Claude Code CLI -------
if ! command -v claude &>/dev/null; then
    echo "  [WARN] Claude Code CLI not found."
    echo "  Install it: npm install -g @anthropic-ai/claude-code"
    echo "  Then run: claude login"
    echo ""
else
    echo "  [OK] Claude Code CLI"
fi

# ------- npm install -------
echo ""
echo "  Installing dependencies..."
npm install --no-fund --no-audit
echo "  [OK] Dependencies installed"

# ------- Configure .env -------
echo ""
if [ -f .env ]; then
    echo "  [OK] .env file already exists, skipping configuration."
    echo "  Edit .env manually if you need to change settings."
else
    echo "  ----------------------------------------"
    echo "   Configuration"
    echo "  ----------------------------------------"
    echo ""
    echo "  You need two things:"
    echo "    1. A Telegram Bot Token from @BotFather"
    echo "    2. Your Telegram User ID from @userinfobot"
    echo ""

    read -rp "  Telegram Bot Token: " BOT_TOKEN
    if [ -z "$BOT_TOKEN" ]; then
        echo "  [ERROR] Bot token cannot be empty."
        exit 1
    fi

    read -rp "  Telegram User ID: " USER_ID
    if [ -z "$USER_ID" ]; then
        echo "  [ERROR] User ID cannot be empty."
        exit 1
    fi

    cat > .env <<EOF
TELEGRAM_BOT_TOKEN=$BOT_TOKEN
ALLOWED_USER_ID=$USER_ID
# ANTHROPIC_API_KEY=
# WORKING_DIRECTORY=
EOF

    echo ""
    echo "  [OK] .env created"
fi

# ------- Done -------
echo ""
echo "  ========================================"
echo "   Setup complete!"
echo "  ========================================"
echo ""
echo "  To start the bot, run:"
echo "    npx tsx src/index.ts"
echo ""
