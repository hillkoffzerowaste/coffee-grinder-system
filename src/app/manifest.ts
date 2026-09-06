import type {MetadataRoute} from "next";

export default function manifest():MetadataRoute.Manifest{
  return {
    name:"Hillkoff Coffee Grinding",
    short_name:"Hillkoff Grinding",
    description:"ระบบรับออเดอร์และจัดคิวบดกาแฟ",
    start_url:"/login",
    display:"standalone",
    orientation:"landscape",
    background_color:"#f3f7f7",
    theme_color:"#064f4d",
    icons:[
      {src:"/icons/hillkoff-192.png",sizes:"192x192",type:"image/png"},
      {src:"/icons/hillkoff-512.png",sizes:"512x512",type:"image/png"},
    ],
  };
}
