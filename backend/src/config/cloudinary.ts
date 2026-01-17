import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";

dotenv.config();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Validate configuration
if (
  !process.env.CLOUDINARY_CLOUD_NAME ||
  !process.env.CLOUDINARY_API_KEY ||
  !process.env.CLOUDINARY_API_SECRET
) {
  console.warn("⚠️  Cloudinary credentials not found in environment variables");
}

export default cloudinary;

// Folder structure constants
export const CLOUDINARY_FOLDERS = {
  PRODUCTS: "speeup/products",
  PRODUCT_GALLERY: "speeup/products/gallery",
  CATEGORIES: "speeup/categories",
  SUBCATEGORIES: "speeup/subcategories",
  COUPONS: "speeup/coupons",
  SELLERS: "speeup/sellers",
  SELLER_PROFILE: "speeup/sellers/profile",
  SELLER_DOCUMENTS: "speeup/sellers/documents",
  DELIVERY: "speeup/delivery",
  DELIVERY_DOCUMENTS: "speeup/delivery/documents",
  STORES: "speeup/stores",
  USERS: "speeup/users",
} as const;
