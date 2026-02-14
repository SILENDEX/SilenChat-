const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const readline = require('readline');
const cookieParser = require('cookie-parser');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const HISTORY_FILE = 'chat_history.json';

app.use(cookieParser());
if (!fs.existsSync(HISTORY_FILE)) { fs.writeFileSync(HISTORY_FILE, JSON.stringify([])); }

const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, 'uploads/') },
  filename: function (req, file, cb) { cb(null, Date.now() + path.extname(file.originalname)) }
});
const upload = multer({ storage: storage });
if (!fs.existsSync('uploads')){ fs.mkdirSync('uploads'); }
app.use('/uploads', express.static('uploads'));

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

app.post('/upload-profile', upload.single('file'), (req, res) => {
  res.send('/uploads/' + req.file.filename);
});

app.post('/upload-file', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).send('No file');
  const fileType = req.file.mimetype.split('/')[0];
  const fileExtension = path.extname(req.file.originalname).toLowerCase();
  let type = 'file';
  if (fileType === 'image') { type = 'image'; }
  else if (fileType === 'audio' || ['.mp3', '.wav', '.ogg', '.aac', '.opus'].includes(fileExtension)) { type = 'audio'; }
  const data = {
    name: req.body.name,
    color: req.body.color,
    pic: req.body.pic,
    url: '/uploads/' + req.file.filename,
    type: type,
    fileName: req.file.originalname
  };
  saveAndBroadcast(data);
  res.send('Uploaded');
});

function saveAndBroadcast(data) {
    const history = JSON.parse(fs.readFileSync(HISTORY_FILE));
    history.push(data);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));
    io.emit('chat message', data);
    console.log(`[CHAT] ${data.name}: ${data.msg || '[File]'}`);
}

// --- LOGIKA UTAMA SOCKET ---
let mutedUsers = new Set(); 
let users = {};

io.on('connection', (socket) => {
    console.log('User terhubung: ' + socket.id);
    
    socket.on('register user', (username) => {
        socket.username = username;
	users[socket.id] = username;
        console.log(`${username} masuk`);
        const history = JSON.parse(fs.readFileSync(HISTORY_FILE));
        socket.emit('load history', history);
    });

    socket.on('chat message', (data) => {
        if (mutedUsers.has(data.name)) {
            socket.emit('chat message', {
                name: "System",
                msg: "Anda sedang dimute.",
                color: "red",
                type: 'text'
            });
        } else {
            saveAndBroadcast(data);
        }
    });

    socket.on('typing', (user) => { 
        if(!mutedUsers.has(user)) {
            socket.broadcast.emit('typing', user); 
        }
    });
    socket.on('stop typing', () => { socket.broadcast.emit('stop typing'); });

    socket.on('disconnect', () => {
	const username = users[socket.id] || 'user';
        console.log(`${username} keluar`);
	delete users[socket.id];
    });
});

// --- CLI COMMAND (ADMIN DI TERMUX) ---
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log('Admin CLI aktif. Ketik /help untuk daftar perintah.');

rl.on('line', (input) => {
    if (input.trim() === '') return;
    
    if (input.startsWith('/')) {
        const parts = input.split(' ');
        const command = parts[0];
        const args = parts.slice(1);

        switch (command) {
            case '/kick':
                if (args[0]) {
                    io.emit('kick user', args[0]);
                    console.log(`User ${args[0]} dikick.`);
                }
                break;
            case '/clear':
                fs.writeFileSync(HISTORY_FILE, JSON.stringify([]));
                io.emit('clear chat');
                console.log('Chat dihapus.');
                break;
            case '/mute':
                if (args[0]) {
                    mutedUsers.add(args[0]);
                    console.log(`User ${args[0]} dimute.`);
                }
                break;
            case '/unmute':
                if (args[0]) {
                    mutedUsers.delete(args[0]);
                    console.log(`User ${args[0]} diunmute.`);
                }
                break;
            case '/announce':
                if (args.length > 0) {
                    io.emit('chat message', {
                        name: "📢 ADMIN",
                        msg: args.join(' '),
                        pic: "/uploads/default.png",
                        color: "#ff4500",
                        type: 'text'
                    });
                    console.log('Pengumuman dikirim.');
                }
                break;
            case '/users':
                const activeUsers = Object.values(io.sockets.sockets).map(s => s.username).filter(Boolean);
                console.log('User online:', activeUsers.join(', '));
                break;
            case '/info':
                const uptimeSeconds = process.uptime();
                const minutes = Math.floor(uptimeSeconds / 60);
                const activeSockets = Object.keys(io.sockets.sockets).length;
                console.log(`--- Status Server ---`);
                console.log(`Port: ${PORT}`);
                console.log(`User Online: ${activeSockets}`);
                console.log(`Uptime: ${minutes} menit`);
                break;
            case '/say':
                const targetSayUser = args[0];
                const messageSay = args.slice(1).join(' ');
                if (targetSayUser && messageSay) {
                    saveAndBroadcast({
                        name: targetSayUser,
                        msg: messageSay,
                        pic: "/uploads/default.png",
                        color: "#ff0000",
                        type: 'text'
                    });
                    console.log(`-_- ${targetSayUser}: ${messageSay}`);
                }
                break;
            case '/logs':
                const history = JSON.parse(fs.readFileSync(HISTORY_FILE));
                const last10 = history.slice(-10);
                console.log('--- 10 Log Chat Terakhir ---');
                last10.forEach(msg => console.log(`[${msg.name}]: ${msg.msg || '[File]'}`));
                break;
            case '/off':
                console.log("Mematikan server...");
                io.emit('chat message', {
                    name: "System",
                    msg: "Server dimatikan.",
                    color: "red",
                    type: 'text'
                });
                setTimeout(() => { process.exit(0); }, 1000);
                break;
            case '/help':
                console.log('Perintah: /kick, /clear, /mute, /unmute, /announce, /users, /info, /say, /logs, /off');
                break;
            default:
                console.log('Perintah tidak dikenal. Ketik /help.');
                break;
        }
    } else {
        // Chat Biasa dari Termux
        saveAndBroadcast({
            name: "Admin",
            msg: input,
            pic: "/uploads/default.png",
            color: "#ff0000",
            type: 'text'
        });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
});
