import Commission from '../models/Commission';
import Order from '../models/Order';
import OrderItem from '../models/OrderItem';
import Seller from '../models/Seller';
import Delivery from '../models/Delivery';
import AppSettings from '../models/AppSettings';
import { creditWallet } from './walletManagementService';
import mongoose from 'mongoose';
import Category from '../models/Category';
import SubCategory from '../models/SubCategory';
import Product from '../models/Product';

/**
 * Get commission rate for a seller
 */
export const getSellerCommissionRate = async (
    sellerId: string
): Promise<number> => {
    try {
        const seller = await Seller.findById(sellerId);
        if (!seller) {
            throw new Error('Seller not found');
        }

        // Use individual rate if set, otherwise use global default
        if (seller.commissionRate !== undefined && seller.commissionRate !== null) {
            return seller.commissionRate;
        }

        const settings = await AppSettings.findOne();
        // @ts-ignore
        return (settings && settings.globalCommissionRate !== undefined) ? settings.globalCommissionRate : 10;
    } catch (error) {
        console.error('Error getting seller commission rate:', error);
        return 10; // Default fallback
    }
};

/**
 * Get commission rate for a delivery boy
 */
export const getDeliveryBoyCommissionRate = async (
    deliveryBoyId: string
): Promise<number> => {
    try {
        const deliveryBoy = await Delivery.findById(deliveryBoyId);
        if (!deliveryBoy) {
            throw new Error('Delivery boy not found');
        }

        // Use individual rate if set, otherwise use global default
        if (deliveryBoy.commissionRate !== undefined && deliveryBoy.commissionRate !== null) {
            return deliveryBoy.commissionRate;
        }

        return 5; // Default 5%
    } catch (error) {
        console.error('Error getting delivery boy commission rate:', error);
        return 5; // Default fallback
    }
};

/**
 * Calculate commissions for an order
 */
export const calculateOrderCommissions = async (orderId: string) => {
    try {
        const order = await Order.findById(orderId).populate('items');
        if (!order) {
            throw new Error('Order not found');
        }

        const commissions: {
            seller?: {
                sellerId: string;
                amount: number;
                rate: number;
                orderAmount: number;
            }[];
            deliveryBoy?: {
                deliveryBoyId: string;
                amount: number;
                rate: number;
                orderAmount: number;
            };
        } = {};

        // Calculate seller commissions (per item/seller)
        const sellerCommissions = new Map<string, { amount: number; rate: number; orderAmount: number }>();

        for (const itemId of order.items) {
            const orderItem = await OrderItem.findById(itemId);
            if (!orderItem) continue;

            const sellerId = orderItem.seller.toString();
            const itemTotal = orderItem.total;

            // Get commission rate for this seller
            const commissionRate = await getSellerCommissionRate(sellerId);
            const commissionAmount = (itemTotal * commissionRate) / 100;

            if (sellerCommissions.has(sellerId)) {
                const existing = sellerCommissions.get(sellerId)!;
                existing.amount += commissionAmount;
                existing.orderAmount += itemTotal;
            } else {
                sellerCommissions.set(sellerId, {
                    amount: commissionAmount,
                    rate: commissionRate,
                    orderAmount: itemTotal,
                });
            }
        }

        // Convert to array
        commissions.seller = Array.from(sellerCommissions.entries()).map(
            ([sellerId, data]) => ({
                sellerId,
                ...data,
            })
        );

        // Calculate delivery boy commission (on order subtotal OR distance based)
        if (order.deliveryBoy) {
            const deliveryBoyId = order.deliveryBoy.toString();

            // Check for distance based commission
            let commissionAmount = 0;
            let commissionRate = 0;
            let usedDistanceBased = false;

            try {
                // @ts-ignore - getSettings is static on model
                const settings = await AppSettings.getSettings();
                if (settings &&
                    settings.deliveryConfig?.isDistanceBased === true &&
                    settings.deliveryConfig?.deliveryBoyKmRate &&
                    order.deliveryDistanceKm &&
                    order.deliveryDistanceKm > 0
                ) {
                    commissionRate = settings.deliveryConfig.deliveryBoyKmRate;
                    commissionAmount = order.deliveryDistanceKm * commissionRate;
                    usedDistanceBased = true;
                    console.log(`DEBUG: Distance Commission: Dist=${order.deliveryDistanceKm}km, Rate=${commissionRate}/km, Amt=${commissionAmount}`);
                }
            } catch (err) {
                console.error("Error checking settings for commission:", err);
            }

            if (!usedDistanceBased) {
                // Fallback to percentage based logic
                commissionRate = await getDeliveryBoyCommissionRate(deliveryBoyId);
                commissionAmount = (order.subtotal * commissionRate) / 100;
            }

            commissions.deliveryBoy = {
                deliveryBoyId,
                amount: Math.round(commissionAmount * 100) / 100, // Round to 2 decimals
                rate: commissionRate,
                orderAmount: usedDistanceBased ? (order.deliveryDistanceKm || 0) : order.subtotal,
            };
        }

        return {
            success: true,
            data: commissions,
        };
    } catch (error: any) {
        console.error('Error calculating order commissions:', error);
        return {
            success: false,
            message: error.message || 'Failed to calculate commissions',
        };
    }
};

/**
 * Create Pending Commissions (called on Order Payment)
 */
export const createPendingCommissions = async (orderId: string) => {
    try {
        const order = await Order.findById(orderId).populate('items');
        if (!order) throw new Error('Order not found');

        // Check if commissions already exist
        const existingCommissions = await Commission.find({ order: orderId });
        if (existingCommissions.length > 0) {
            console.log(`Commissions already exist for order ${orderId}`);
            return;
        }

        const items = order.items;
        // Group items by seller to aggregate earnings (though we store per item mostly)
        // We'll calculate per item as per original logic

        for (const itemId of items) {
            const item = await OrderItem.findById(itemId);
            if (!item) continue;

            const seller = await Seller.findById(item.seller);
            if (!seller) continue;

            // Determine Commission Rate Priority:
            // 1. SubSubCategory (Category Model)
            // 2. SubCategory (SubCategory Model)
            // 3. Category (Category Model)
            // 4. Seller specific rate
            // 5. Global Default (10%)

            let commissionRate = 0;
            let rateSource = "Default";

            const product = await Product.findById(item.product);

            if (product) {
                // 1. Check SubSubCategory
                if (product.subSubCategory) {
                    const subSubCat = await Category.findById(product.subSubCategory);
                    if (subSubCat && subSubCat.commissionRate && subSubCat.commissionRate > 0) {
                        commissionRate = subSubCat.commissionRate;
                        rateSource = `SubSubCategory: ${subSubCat.name}`;
                    }
                }

                // 2. Check SubCategory (only if not found yet)
                if (commissionRate === 0 && product.subcategory) {
                    const subCat = await SubCategory.findById(product.subcategory);
                    if (subCat && subCat.commissionRate && subCat.commissionRate > 0) {
                        commissionRate = subCat.commissionRate;
                        rateSource = `SubCategory: ${subCat.name}`;
                    }
                }

                // 3. Check Category (only if not found yet)
                if (commissionRate === 0 && product.category) {
                    const cat = await Category.findById(product.category);
                    if (cat && cat.commissionRate && cat.commissionRate > 0) {
                        commissionRate = cat.commissionRate;
                        rateSource = `Category: ${cat.name}`;
                    }
                }
            }

            // 4. Check Seller specifc rate
            if (commissionRate === 0 && seller.commission !== undefined && seller.commission > 0) {
                commissionRate = seller.commission;
                rateSource = "Seller";
            }

            // 5. Global Default (fallback if everything else is 0)
            if (commissionRate === 0) {
                // Fetch dynamic global rate from AppSettings
                const settings = await AppSettings.findOne();
                // @ts-ignore
                commissionRate = (settings && settings.globalCommissionRate !== undefined) ? settings.globalCommissionRate : 10;
                rateSource = "Global Default (Settings)";
            }

            const commissionAmount = (item.total * commissionRate) / 100;
            const netEarning = item.total - commissionAmount;

            console.log(`[Commission] Item: ${product?.productName}, Rate: ${commissionRate}% (${rateSource}), Amount: ${commissionAmount}, Net: ${netEarning}`);

            // Create commission record as PAID immediately
            const commission = await Commission.create({
                order: item.order,
                orderItem: item._id,
                seller: item.seller,
                type: 'SELLER',
                orderAmount: item.total,
                commissionRate,
                commissionAmount,
                status: "Paid", // Set to Paid immediately
                paidAt: new Date()
            });

            // Credit Wallet Immediately
            if (seller) {
                await creditWallet(
                    seller._id.toString(),
                    'SELLER',
                    netEarning,
                    `Sale proceeds from Order #${order.orderNumber}`,
                    item.order.toString(),
                    commission._id.toString()
                );
            }
        }

        console.log(`Commissions processed and credited for order ${orderId}`);

    } catch (error) {
        console.error("Error creating commissions:", error);
        throw error;
    }
};

/**
 * Distribute commissions for an order (Pending -> Paid)
 */
export const distributeCommissions = async (orderId: string) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const order = await Order.findById(orderId).session(session);
        if (!order) {
            throw new Error('Order not found');
        }

        // Check if order is delivered
        if (order.status !== 'Delivered') {
            throw new Error('Commissions can only be distributed for delivered orders');
        }

        // Check for Delivery Boy Commission
        if (order.deliveryBoy) {
            const deliveryBoyId = order.deliveryBoy.toString();
            const existingDeliveryComm = await Commission.findOne({
                order: orderId,
                type: 'DELIVERY_BOY'
            }).session(session);

            if (!existingDeliveryComm) {
                console.log(`Creating missing commission for Delivery Boy ${deliveryBoyId}`);

                // Calculate Commission Logic
                let commissionAmount = 0;
                let commissionRate = 0;
                let usedDistanceBased = false;

                try {
                    // @ts-ignore
                    const settings = await AppSettings.getSettings();
                    if (settings &&
                        settings.deliveryConfig?.isDistanceBased === true &&
                        settings.deliveryConfig?.deliveryBoyKmRate &&
                        order.deliveryDistanceKm &&
                        order.deliveryDistanceKm > 0
                    ) {
                        commissionRate = settings.deliveryConfig.deliveryBoyKmRate;
                        commissionAmount = order.deliveryDistanceKm * commissionRate;
                        usedDistanceBased = true;
                    }
                } catch (err) {
                    console.error("Error checking settings for commission:", err);
                }

                if (!usedDistanceBased) {
                    // Fallback to percentage based logic
                    // We need to fetch it again or move helper to top
                    const deliveryBoy = await Delivery.findById(deliveryBoyId);
                    commissionRate = (deliveryBoy?.commissionRate !== undefined) ? deliveryBoy.commissionRate : 5;
                    commissionAmount = (order.subtotal * commissionRate) / 100;
                }

                // Create Commission Record
                const newComm = await Commission.create([{
                    order: order._id,
                    deliveryBoy: order.deliveryBoy,
                    type: 'DELIVERY_BOY',
                    orderAmount: usedDistanceBased ? (order.deliveryDistanceKm || 0) : order.subtotal,
                    commissionRate,
                    commissionAmount: Math.round(commissionAmount * 100) / 100,
                    status: 'Paid',
                    paidAt: new Date()
                }], { session });

                const comm = newComm[0];

                // Credit Wallet Immediately
                await creditWallet(
                    deliveryBoyId,
                    'DELIVERY_BOY',
                    comm.commissionAmount,
                    `Delivery earning for order ${order.orderNumber}`,
                    orderId,
                    comm._id.toString(),
                    session
                );
            }
        }

        await session.commitTransaction();

        return {
            success: true,
            message: 'Commissions distributed (delivery boy only checked as seller is instant)',
        };
    } catch (error: any) {
        await session.abortTransaction();
        console.error('Error distributing commissions:', error);
        return {
            success: false,
            message: error.message || 'Failed to distribute commissions',
        };
    } finally {
        session.endSession();
    }
};

/**
 * Get commission summary for a user
 */
export const getCommissionSummary = async (
    userId: string,
    userType: 'SELLER' | 'DELIVERY_BOY'
) => {
    try {
        const query = userType === 'SELLER' ? { seller: userId } : { deliveryBoy: userId };

        const commissions = await Commission.find(query).sort({ createdAt: -1 });

        const summary = {
            total: 0,
            paid: 0,
            pending: 0,
            count: commissions.length,
            commissions: commissions.map((c) => ({
                id: c._id,
                orderId: c.order,
                amount: c.commissionAmount,
                rate: c.commissionRate,
                orderAmount: c.orderAmount,
                status: c.status,
                paidAt: c.paidAt,
                createdAt: c.createdAt,
            })),
        };

        commissions.forEach((c) => {
            // For Sellers, earning is Order Amount - Commission Amount
            // For Delivery Boys, earning is the Commission Amount itself
            const earningAmount = userType === 'SELLER'
                ? (c.orderAmount - c.commissionAmount)
                : c.commissionAmount;

            summary.total += earningAmount;
            if (c.status === 'Paid') {
                summary.paid += earningAmount;
            } else if (c.status === 'Pending') {
                summary.pending += earningAmount;
            }
        });

        return {
            success: true,
            data: summary,
        };
    } catch (error: any) {
        console.error('Error getting commission summary:', error);
        return {
            success: false,
            message: error.message || 'Failed to get commission summary',
        };
    }
};

/**
 * Reverse commissions for a cancelled/returned order
 */
export const reverseCommissions = async (orderId: string) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const commissions = await Commission.find({ order: orderId }).session(session);

        if (commissions.length === 0) {
            // No commissions to reverse
            return {
                success: true,
                message: 'No commissions to reverse',
            };
        }

        for (const commission of commissions) {
            // Only reverse if status is Paid
            if (commission.status === 'Paid') {
                commission.status = 'Cancelled';
                await commission.save({ session });

                // Debit from wallet
                const userId = commission.type === 'SELLER' ? commission.seller : commission.deliveryBoy;
                const userType = commission.type;

                if (userId) {
                    const { debitWallet } = await import('./walletManagementService');
                    await debitWallet(
                        userId.toString(),
                        userType,
                        commission.commissionAmount,
                        `Commission reversal for cancelled order`,
                        orderId,
                        session
                    );
                }
            }
        }

        await session.commitTransaction();

        return {
            success: true,
            message: 'Commissions reversed successfully',
        };
    } catch (error: any) {
        await session.abortTransaction();
        console.error('Error reversing commissions:', error);
        return {
            success: false,
            message: error.message || 'Failed to reverse commissions',
        };
    } finally {
        session.endSession();
    }
};
