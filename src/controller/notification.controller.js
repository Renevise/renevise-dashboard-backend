const NotificationModel = require('../model/notification.model');

async function getMyNotifications(req, res) {
    try {
        const userId = req.user.userId;
        const notifications = await NotificationModel.find({ userId }).sort({ createdAt: -1 });
        const unreadCount   = notifications.filter(n => !n.read).length;
        return res.status(200).json({ notifications, unreadCount });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
}

async function markAsRead(req, res) {
    try {
        const { id } = req.params;
        const userId = req.user.userId;

        const notification = await NotificationModel.findOne({ _id: id, userId });
        if (!notification) return res.status(404).json({ message: 'Notification not found' });

        notification.read = true;
        await notification.save();

        return res.status(200).json({ message: 'Marked as read', notification });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
}

async function markAllAsRead(req, res) {
    try {
        const userId = req.user.userId;
        await NotificationModel.updateMany({ userId, read: false }, { read: true });
        return res.status(200).json({ message: 'All notifications marked as read' });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
}

module.exports = { getMyNotifications, markAsRead, markAllAsRead };
