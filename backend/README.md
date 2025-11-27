# Backend (Engine API) - Ops Notes

## Install dependencies
```bash
sudo apt-get update && sudo apt-get install -y stockfish
cd backend
npm install
```

## Local run
```bash
npm run dev   # or: npm start
curl http://localhost:${PORT:-8788}/health
```

## systemd (optional, recommended for .deb)
1) Copy files
```bash
sudo useradd --system --home /opt/chess-analysis --shell /usr/sbin/nologin chess || true
sudo mkdir -p /opt/chess-analysis
sudo rsync -a ./backend/ /opt/chess-analysis/backend/
sudo chown -R chess:chess /opt/chess-analysis
sudo cp ../chess-engine.service /etc/systemd/system/chess-engine.service
sudo cp ../chess-engine.env.sample /etc/chess-engine.env
```

2) Edit `/etc/chess-engine.env` as needed (PORT, SF_THREADS, LC0_* paths).

3) Enable and start
```bash
sudo systemctl daemon-reload
sudo systemctl enable chess-engine
sudo systemctl start chess-engine
sudo systemctl status chess-engine --no-pager
```

Logs:
```bash
journalctl -u chess-engine -f
```
