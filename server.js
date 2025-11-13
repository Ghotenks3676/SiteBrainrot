const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Armazenamento em memória
const chatConnections = new Map();

// WebSocket melhorado
wss.on('connection', (ws, req) => {
    console.log('🔗 Nova conexão WebSocket estabelecida');
    
    const url = new URL(req.url, `http://${req.headers.host}`);
    const chatId = url.searchParams.get('chatId');
    const userType = url.searchParams.get('userType') || 'client';
    
    if (chatId) {
        if (!chatConnections.has(chatId)) {
            chatConnections.set(chatId, new Set());
        }
        
        ws.chatId = chatId;
        ws.userType = userType;
        
        chatConnections.get(chatId).add(ws);
        
        console.log(`✅ ${userType.toUpperCase()} conectado ao chat ${chatId}`);
        
        ws.send(JSON.stringify({
            type: 'connection_established',
            chatId: chatId,
            userType: userType
        }));
    }

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            if (message.type === 'chat_message' && ws.chatId) {
                saveMessageToChat(ws.chatId, message.data);
                
                broadcastToChat(ws.chatId, {
                    type: 'new_message',
                    message: message.data,
                    sender: ws.userType
                });
            }
            
            if (message.type === 'payment_confirmation' && ws.userType === 'admin') {
                handlePaymentConfirmation(ws.chatId, message.data);
            }
            
            if (message.type === 'rating' && ws.userType === 'client') {
                handleRating(ws.chatId, message.data);
            }
            
        } catch (error) {
            console.error('❌ Erro ao processar mensagem WebSocket:', error);
        }
    });

    ws.on('close', () => {
        if (ws.chatId && chatConnections.has(ws.chatId)) {
            chatConnections.get(ws.chatId).delete(ws);
            if (chatConnections.get(ws.chatId).size === 0) {
                chatConnections.delete(ws.chatId);
            }
        }
        console.log(`🔌 ${ws.userType} desconectado do chat ${ws.chatId}`);
    });

    ws.on('error', (error) => {
        console.error('❌ Erro WebSocket:', error);
    });
});

function broadcastToChat(chatId, message) {
    if (chatConnections.has(chatId)) {
        chatConnections.get(chatId).forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(message));
            }
        });
    }
}

function saveMessageToChat(chatId, message) {
    try {
        const messages = JSON.parse(localStorage.getItem(`chat_${chatId}`) || '[]');
        messages.push(message);
        localStorage.setItem(`chat_${chatId}`, JSON.stringify(messages));
        
        // Atualizar também o pedido com a última mensagem
        updateOrderLastMessage(chatId, message);
    } catch (error) {
        console.error('❌ Erro ao salvar mensagem:', error);
    }
}

function updateOrderLastMessage(chatId, message) {
    try {
        const orders = JSON.parse(localStorage.getItem('allOrders') || '[]');
        const orderIndex = orders.findIndex(order => order.chatId === chatId);
        
        if (orderIndex !== -1) {
            orders[orderIndex].lastMessage = message.text;
            orders[orderIndex].lastMessageTime = message.timestamp;
            orders[orderIndex].unread = (orders[orderIndex].unread || 0) + 1;
            localStorage.setItem('allOrders', JSON.stringify(orders));
        }
    } catch (error) {
        console.error('❌ Erro ao atualizar última mensagem:', error);
    }
}

function handlePaymentConfirmation(chatId, data) {
    try {
        const orders = JSON.parse(localStorage.getItem('allOrders') || '[]');
        const orderIndex = orders.findIndex(order => order.chatId === chatId);
        
        if (orderIndex !== -1) {
            orders[orderIndex].paymentStatus = 'paid';
            localStorage.setItem('allOrders', JSON.stringify(orders));
            
            const systemMessage = {
                id: Date.now(),
                text: '✅ Pagamento confirmado pelo administrador! Seu pedido está sendo processado.',
                sender: 'system',
                timestamp: new Date().toISOString(),
                type: 'system'
            };
            
            saveMessageToChat(chatId, systemMessage);
            broadcastToChat(chatId, {
                type: 'new_message',
                message: systemMessage,
                sender: 'system'
            });
            
            broadcastToChat(chatId, {
                type: 'payment_updated',
                status: 'paid'
            });
        }
    } catch (error) {
        console.error('❌ Erro ao confirmar pagamento:', error);
    }
}

function handleRating(chatId, data) {
    const { rating, comment } = data;
    
    const ratings = JSON.parse(localStorage.getItem('chat_ratings') || '[]');
    ratings.push({
        chatId: chatId,
        rating: rating,
        comment: comment,
        timestamp: new Date().toISOString()
    });
    localStorage.setItem('chat_ratings', JSON.stringify(ratings));
    
    const systemMessage = {
        id: Date.now(),
        text: `⭐ Obrigado pela avaliação! Você deu ${rating} estrelas${comment ? ': ' + comment : ''}`,
        sender: 'system',
        timestamp: new Date().toISOString(),
        type: 'system'
    };
    
    saveMessageToChat(chatId, systemMessage);
    broadcastToChat(chatId, {
        type: 'new_message',
        message: systemMessage,
        sender: 'system'
    });
}

// Rotas básicas
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/admin-chat.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/admin-chat.html'));
});

app.get('/client-chat.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/client-chat.html'));
});

app.get('/checkout.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/checkout.html'));
});

// API para produtos
app.get('/produtos', (req, res) => {
    try {
        const produtosPath = path.join(__dirname, 'data/produtos.json');
        if (fs.existsSync(produtosPath)) {
            const produtos = JSON.parse(fs.readFileSync(produtosPath, 'utf8'));
            res.json(produtos);
        } else {
            res.json([]);
        }
    } catch (error) {
        console.error('❌ Erro ao carregar produtos:', error);
        res.status(500).json({ error: 'Erro ao carregar produtos' });
    }
});

app.post('/produtos', (req, res) => {
    try {
        const produtos = req.body;
        const produtosPath = path.join(__dirname, 'data/produtos.json');
        
        const dir = path.dirname(produtosPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(produtosPath, JSON.stringify(produtos, null, 2));
        res.json({ message: 'Produtos salvos com sucesso!' });
    } catch (error) {
        console.error('❌ Erro ao salvar produtos:', error);
        res.status(500).json({ error: 'Erro ao salvar produtos' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        activeChats: Array.from(chatConnections.keys()),
        totalConnections: Array.from(chatConnections.values()).reduce((acc, set) => acc + set.size, 0)
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📱 Acesse: http://localhost:${PORT}`);
    console.log(`💬 WebSocket ativo para chats em tempo real`);
    
    const dataDir = './data';
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
        console.log(`📁 Diretório de dados criado: ${dataDir}`);
    }

});
