import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Camera, Upload, Loader2, Image as ImageIcon } from "lucide-react";

interface ScanProductDialogProps {
  shopId: string;
  onProductAdded: () => void;
}

const ScanProductDialog = ({ shopId, onProductAdded }: ScanProductDialogProps) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [extractedData, setExtractedData] = useState<any>(null);
  const [cameraMode, setCameraMode] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleImageUpload = async (file: File) => {
    setScanning(true);

    try {
      // Convert image to base64
      const reader = new FileReader();
      reader.readAsDataURL(file);
      
      reader.onload = async () => {
        const base64 = reader.result?.toString().split(',')[1];
        
        if (!base64) {
          throw new Error('Failed to read image');
        }

        // Call OCR edge function
        const { data, error } = await supabase.functions.invoke('ocr-scan', {
          body: { imageBase64: base64 }
        });

        if (error) throw error;

        console.log('OCR Result:', data);

        setExtractedData(data);
        
        toast({
          title: "Image Processed!",
          description: `Extracted: ${data.productName || 'Product'} - Confidence: ${Math.round((data.confidence?.overall || 0) * 100)}%`,
        });
      };

      reader.onerror = () => {
        throw new Error('Failed to read image');
      };

    } catch (error: any) {
      console.error('OCR Error:', error);
      toast({
        title: "Scan Failed",
        description: error.message || "Could not extract product information from image",
        variant: "destructive",
      });
    } finally {
      setScanning(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImageUpload(file);
    }
  };

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImageUpload(file);
    }
  };

  const handleAddProduct = async () => {
    if (!extractedData) return;

    setLoading(true);

    try {
      let productId: string;

      // Check if product exists
      const { data: existingProduct } = await supabase
        .from("products")
        .select("id")
        .eq("name", extractedData.productName)
        .eq("brand", extractedData.brand || "")
        .single();

      if (existingProduct) {
        productId = existingProduct.id;
      } else {
        const { data: newProduct, error: productError } = await supabase
          .from("products")
          .insert({
            name: extractedData.productName,
            brand: extractedData.brand || "Unknown",
            category: "General",
            default_mrp: extractedData.mrp || 0,
            gtin: extractedData.gtin || null,
          })
          .select()
          .single();

        if (productError) throw productError;
        productId = newProduct.id;
      }

      // Calculate discount
      let discountPercent = 0;
      if (extractedData.expiryDate) {
        const daysToExpiry = Math.ceil(
          (new Date(extractedData.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );
        
        if (daysToExpiry <= 30 && daysToExpiry > 15) {
          discountPercent = 10;
        } else if (daysToExpiry <= 15 && daysToExpiry > 7) {
          discountPercent = 20;
        } else if (daysToExpiry <= 7 && daysToExpiry > 0) {
          discountPercent = 30;
        }
      }

      // Add to inventory
      const { error: batchError } = await supabase.from("inventory_batches").insert({
        shop_id: shopId,
        product_id: productId,
        batch_code: extractedData.batchCode || `BATCH-${Date.now()}`,
        quantity: extractedData.quantity || 1,
        expiry_date: extractedData.expiryDate || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        mrp: extractedData.mrp || 0,
        discount_percent: discountPercent,
      });

      if (batchError) throw batchError;

      toast({
        title: "Product Added!",
        description: discountPercent > 0 
          ? `Auto-discount of ${discountPercent}% applied`
          : "Successfully added to inventory",
      });

      setExtractedData(null);
      setOpen(false);
      onProductAdded();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Camera className="w-4 h-4 mr-2" />
          Scan Product
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Scan Product Packaging</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!extractedData ? (
            <div className="space-y-4">
              <div className="flex flex-col items-center justify-center py-8 border-2 border-dashed rounded-lg">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleCameraCapture}
                  className="hidden"
                />
                
                {scanning ? (
                  <div className="text-center">
                    <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
                    <p className="text-sm text-muted-foreground">Processing image with AI...</p>
                  </div>
                ) : (
                  <>
                    <ImageIcon className="w-12 h-12 text-muted-foreground mb-4" />
                    <div className="flex gap-3">
                      <Button onClick={() => cameraInputRef.current?.click()} variant="default">
                        <Camera className="w-4 h-4 mr-2" />
                        Take Photo
                      </Button>
                      <Button onClick={() => fileInputRef.current?.click()} variant="outline">
                        <Upload className="w-4 h-4 mr-2" />
                        Upload Image
                      </Button>
                    </div>
                    <p className="text-sm text-muted-foreground mt-3 text-center">
                      Capture or upload a photo of the product barcode/label
                    </p>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Product Name</Label>
                  <Input value={extractedData.productName || ""} readOnly />
                </div>
                <div>
                  <Label>Brand</Label>
                  <Input value={extractedData.brand || ""} readOnly />
                </div>
                <div>
                  <Label>Barcode/GTIN</Label>
                  <Input value={extractedData.gtin || "Not detected"} readOnly />
                </div>
                <div>
                  <Label>Batch Code</Label>
                  <Input value={extractedData.batchCode || "Auto-generated"} readOnly />
                </div>
                <div>
                  <Label>Expiry Date</Label>
                  <Input
                    type="date"
                    value={extractedData.expiryDate || ""}
                    onChange={(e) => setExtractedData({...extractedData, expiryDate: e.target.value})}
                  />
                </div>
                <div>
                  <Label>MRP (₹)</Label>
                  <Input
                    type="number"
                    value={extractedData.mrp || ""}
                    onChange={(e) => setExtractedData({...extractedData, mrp: parseFloat(e.target.value)})}
                  />
                </div>
                <div>
                  <Label>Quantity</Label>
                  <Input
                    type="number"
                    value={extractedData.quantity || 1}
                    onChange={(e) => setExtractedData({...extractedData, quantity: parseInt(e.target.value)})}
                  />
                </div>
              </div>

              {extractedData.confidence && (
                <div className="p-4 bg-secondary/50 rounded-lg">
                  <p className="text-sm font-medium mb-2">Extraction Confidence</p>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span>Overall:</span>
                      <span className="font-semibold">{Math.round(extractedData.confidence.overall * 100)}%</span>
                    </div>
                    {extractedData.confidence.productName && (
                      <div className="flex justify-between">
                        <span>Product Name:</span>
                        <span>{Math.round(extractedData.confidence.productName * 100)}%</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setExtractedData(null)}>
                  Scan Again
                </Button>
                <Button onClick={handleAddProduct} disabled={loading}>
                  {loading ? "Adding..." : "Add to Inventory"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ScanProductDialog;