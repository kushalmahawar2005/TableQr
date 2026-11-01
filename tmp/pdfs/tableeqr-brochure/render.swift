import PDFKit
import AppKit
let dir=CommandLine.arguments[1]
let doc=PDFDocument(url:URL(fileURLWithPath:CommandLine.arguments[2]))!
for i in 0..<doc.pageCount {
 let page=doc.page(at:i)!
 let im=page.thumbnail(of:NSSize(width:810,height:1440),for:.mediaBox)
 let data=NSBitmapImageRep(data:im.tiffRepresentation!)!.representation(using:.png,properties:[:])!
 try! data.write(to:URL(fileURLWithPath:dir+"/page-\(i+1).png"))
}
