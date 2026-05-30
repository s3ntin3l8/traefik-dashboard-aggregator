// Sel is the drawer selection: which entity is open in the detail drawer.
export type SelKind = "router" | "service" | "middleware" | "instance" | "cert";
export interface Sel {
  kind: SelKind;
  data: any;
}
