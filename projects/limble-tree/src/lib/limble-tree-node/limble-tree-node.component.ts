import {
   AfterViewInit,
   ChangeDetectorRef,
   Component,
   ElementRef,
   Input,
   NgZone,
   OnDestroy,
   OnInit,
   ViewChild,
   ViewContainerRef
} from "@angular/core";
import { ComponentCreatorService } from "../singletons/component-creator.service";
import { DropZoneService } from "../limble-tree-root/drop-zone.service";
import { DragStateService } from "../singletons/drag-state.service";
import { LimbleTreeNode, TreeService } from "../limble-tree-root/tree.service";
import { Branch, BranchCoordinates } from "../classes/Branch";
import { arraysAreEqual, isDraggingAllowed, isNestingAllowed } from "../util";
import { filter, first, skip, skipUntil } from "rxjs/operators";
import { GlobalEventsService } from "../singletons/global-events.service";
import { DropZone } from "../classes/DropZone";
import { merge, Subscription } from "rxjs";

@Component({
   selector: "limble-tree-node",
   templateUrl: "./limble-tree-node.component.html",
   styleUrls: ["./limble-tree-node.component.scss"]
})
export class LimbleTreeNodeComponent
   implements OnInit, AfterViewInit, OnDestroy {
   @Input() branch: Branch<any> | undefined;
   @ViewChild("nodeHost", { read: ViewContainerRef }) private nodeHost:
      | ViewContainerRef
      | undefined;
   public dropZoneAbove: DropZone | undefined;
   public renderDropZoneAbove: boolean;
   public dropZoneBelow: DropZone | undefined;
   public renderDropZoneBelow: boolean;
   public dropZoneInside: DropZone | undefined;
   public renderDropZoneInside: boolean;
   public readonly renderInnerBranch: Boolean;
   @ViewChild("draggableDiv", { read: ElementRef }) private draggableDiv:
      | ElementRef<HTMLElement>
      | undefined;
   @ViewChild("nodeHostContainer", { read: ElementRef })
   private nodeHostContainer: ElementRef<HTMLElement> | undefined;
   private currentBranchCoordinates: BranchCoordinates | undefined;
   private readonly treeChangeSubscription: Subscription;
   @Input() parentHost: ViewContainerRef | undefined;

   constructor(
      private readonly componentCreatorService: ComponentCreatorService,
      private readonly changeDetectorRef: ChangeDetectorRef,
      private readonly dragStateService: DragStateService,
      private readonly dropZoneService: DropZoneService,
      private readonly treeService: TreeService,
      private readonly globalEventsService: GlobalEventsService,
      private readonly ngZone: NgZone
   ) {
      if (
         this.treeService.treeOptions !== undefined &&
         this.treeService.treeOptions.listMode !== true &&
         this.treeService.getPlaceholder() !== true
      ) {
         this.renderInnerBranch = true;
      } else {
         this.renderInnerBranch = false;
      }
      this.renderDropZoneBelow = false;
      this.renderDropZoneAbove = false;
      this.renderDropZoneInside = false;
      this.treeChangeSubscription = this.treeService.changes$
         .pipe(
            //The first one is the initial tree render, which we can ignore
            skip(1)
         )
         .subscribe(() => {
            this.treeChangeHandler();
         });
   }

   private treeChangeHandler() {
      if (
         this.branch !== undefined &&
         this.currentBranchCoordinates !== undefined &&
         !arraysAreEqual(
            this.branch.getCoordinates(),
            this.currentBranchCoordinates
         )
      ) {
         this.updateDropZones();
      }
   }

   ngOnInit() {
      if (this.treeService.treeOptions?.allowDragging === false) {
         return;
      }
      const parent = this.branch?.getParent();
      if (parent?.data !== null) {
         const parentData = parent?.data as LimbleTreeNode;
         if (!isNestingAllowed(this.treeService.treeOptions, parentData)) {
            return;
         }
      }
      this.registerDropZones();
      this.currentBranchCoordinates = this.branch?.getCoordinates();
      this.ngZone.runOutsideAngular(() => {
         if (
            this.dropZoneAbove === undefined ||
            this.dropZoneBelow === undefined ||
            this.dropZoneInside === undefined
         ) {
            throw new Error("Zones not registered");
         }
         merge(
            this.dropZoneAbove.getCommChannel(),
            this.dropZoneBelow.getCommChannel(),
            this.dropZoneInside.getCommChannel()
         )
            .pipe(filter((message) => message === "checkRendered"))
            .subscribe(() => {
               if (
                  this.dropZoneAbove === undefined ||
                  this.dropZoneBelow === undefined ||
                  this.dropZoneInside === undefined ||
                  this.branch === undefined
               ) {
                  throw new Error("Zones not registered");
               }
               this.renderDropZoneAbove = this.dropZoneAbove.isRendered();
               if (this.treeService.getPlaceholder() === true) {
                  //Only render one drop zone if the placeholder system is active
                  return;
               }
               this.renderDropZoneBelow = this.dropZoneBelow.isRendered();
               if (
                  isNestingAllowed(
                     this.treeService.treeOptions,
                     this.branch.data
                  )
               ) {
                  this.renderDropZoneInside = this.dropZoneInside.isRendered();
               }
            });
      });
   }

   ngAfterViewInit() {
      this.renderNode();
      this.setDropZoneHosts();
      this.checkForHandle();
      this.changeDetectorRef.detectChanges();
   }

   ngOnDestroy() {
      this.treeChangeSubscription.unsubscribe();
      if (this.dropZoneAbove !== undefined) {
         this.dropZoneService.removeDropZone(this.dropZoneAbove);
      }
      if (this.dropZoneBelow !== undefined) {
         this.dropZoneService.removeDropZone(this.dropZoneBelow);
      }
      if (this.dropZoneInside !== undefined) {
         this.dropZoneService.removeDropZone(this.dropZoneInside);
      }
      this.treeService.cleanupSignal$.next(null);
   }

   public dragstartHandler(event: DragEvent): void {
      event.stopPropagation();
      if (
         event.dataTransfer === null ||
         this.branch === undefined ||
         this.parentHost === undefined
      ) {
         throw new Error("failed to run dragstartHandler");
      }
      const draggedElement = event.target as HTMLElement;
      if (draggedElement.parentElement?.tagName !== "LIMBLE-TREE-NODE") {
         //Don't drag stuff that isn't part of the tree
         event.preventDefault();
         return;
      }
      event.dataTransfer.effectAllowed = "move";
      this.dragStateService.dragging(this.branch, this.parentHost);
      //We have to use a setTimeout due to a bug in chrome: https://stackoverflow.com/a/20733870/8796651
      setTimeout(() => {
         draggedElement.classList.add("dragging");
         if (this.branch === undefined) {
            throw new Error("Could not show surrounding drop zones");
         }
         const parent = this.branch.getParent();
         let parentData: LimbleTreeNode;
         let parentNestingAllowed = true;
         if (parent?.data !== null) {
            parentData = parent?.data as LimbleTreeNode;
            parentNestingAllowed = isNestingAllowed(
               this.treeService.treeOptions,
               parentData
            );
         }
         if (this.dropZoneAbove !== undefined && parentNestingAllowed) {
            this.dropZoneService.showDropZoneFamily(this.dropZoneAbove, {
               joinFamilies: true
            });
            if (
               this.treeService.treeData?.length === 1 &&
               this.branch.getCoordinates().length === 1
            ) {
               //We are dragging the only element in the tree, so we have to use the placeholder system
               this.treeService.usePlaceholder();
            }
         }
      });
   }

   public dragendHandler(event?: DragEvent): void {
      event?.stopPropagation();
      if (this.draggableDiv === undefined) {
         throw new Error("could not get draggable div");
      }
      this.draggableDiv.nativeElement.classList.remove("dragging");
      if (this.dragStateService.getState() === "captured") {
         if (this.treeService.captured === false) {
            //Dropped in a different tree. Remove the one in this tree
            if (this.branch === undefined) {
               throw new Error("could not get branch in dragendHandler");
            }
            this.treeService.cleanupSignal$.next(null);
            this.treeService.captured = false;
         }
         this.dragStateService.release();
      } else {
         //Wasn't dropped into a valid tree, so reset for next drag and
         //don't do anything else.
         this.dragStateService.release();
         this.dropZoneService.clearVisibleZones();
         this.dropZoneService.restoreFamilies();
         this.treeService.removePlaceholder();
      }
   }

   public dragoverHandler(event: DragEvent) {
      if (this.globalEventsService.scrolling === true) {
         return;
      }
      if (this.branch === undefined) {
         throw new Error("Can't get current branch during dragover event");
      }
      const data = this.dragStateService.getData();
      if (data === undefined) {
         //They might be dragging something that isn't a node. Just ignore it.
         return;
      }
      const sourceBranch = data.branch;
      //If trying to drop on self, return.
      if (
         sourceBranch === this.branch ||
         this.branch.getAncestors().includes(sourceBranch)
      ) {
         return;
      }
      if (
         this.treeService.getPlaceholder() === true &&
         this.dropZoneAbove !== undefined
      ) {
         //If placeholder system is active, then activate the only existing drop zone
         //and skip the rest of the logic in this function
         this.dropZoneService.showDropZoneFamily(this.dropZoneAbove);
         return;
      }
      const target = event.currentTarget as HTMLElement;
      const topLine = target.offsetHeight / 3; //an imaginary line 1/3 of the way down from the top of the element;
      const bottomLine = topLine * 2; //an imaginary line 1/3 of the way up from the bottom of the element;
      const parent = this.branch.getParent();
      let parentData: LimbleTreeNode;
      let parentNestingAllowed = true;
      if (parent?.data !== null) {
         parentData = parent?.data as LimbleTreeNode;
         parentNestingAllowed = isNestingAllowed(
            this.treeService.treeOptions,
            parentData
         );
      }
      const activeDropZone = this.dropZoneService.getActiveDropZone();
      if (
         event.offsetY < topLine &&
         this.dropZoneAbove !== undefined &&
         (activeDropZone === null ||
            !DropZone.dropZoneLocationsAreEqual(
               activeDropZone,
               this.dropZoneAbove
            )) &&
         parentNestingAllowed
      ) {
         const index = this.branch.getIndex();
         if (index === undefined || index === null) {
            throw new Error("can't get branch index");
         }
         this.dropZoneService.showDropZoneFamily(this.dropZoneAbove, {
            activateLowestInsteadOfFounder: true
         });
      } else if (
         event.offsetY < bottomLine &&
         this.dropZoneInside !== undefined &&
         (activeDropZone === null ||
            !DropZone.dropZoneLocationsAreEqual(
               activeDropZone,
               this.dropZoneInside
            ))
      ) {
         this.dropZoneService.showDropZoneFamily(this.dropZoneInside);
      } else if (
         event.offsetY >= bottomLine &&
         this.dropZoneBelow !== undefined &&
         (activeDropZone === null ||
            !DropZone.dropZoneLocationsAreEqual(
               activeDropZone,
               this.dropZoneBelow
            )) &&
         this.branch.getChildren().length === 0 &&
         parentNestingAllowed
      ) {
         const index = this.branch.getIndex();
         if (index === undefined || index === null) {
            throw new Error("can't get branch index");
         }
         this.dropZoneService.showDropZoneFamily(this.dropZoneBelow);
      }
   }

   private renderNode() {
      if (this.nodeHost === undefined || this.branch === undefined) {
         throw new Error("Failed to render tree node");
      }
      let component = this.branch.data.component;
      if (component === undefined) {
         component = this.treeService.treeOptions?.defaultComponent;
      }
      if (component === undefined) {
         throw new Error("limbleTree requires a component to render");
      }
      const componentRef = this.componentCreatorService.appendComponent<any>(
         component.class,
         this.nodeHost
      );
      componentRef.instance.nodeData = this.branch.data;
      for (const binding in component.bindings) {
         componentRef.instance[binding] = component.bindings[binding];
      }
   }

   private registerDropZones(): void {
      this.addDropZoneAbove();
      this.addDropZoneBelow();
      this.addDropZoneInside();
   }

   private addDropZoneAbove(): void {
      if (this.branch === undefined) {
         throw new Error("failed to register drop zone above");
      }
      const parent = this.branch.getParent();
      const currentCoordinates = this.branch.getCoordinates();
      const index = currentCoordinates[currentCoordinates.length - 1];
      this.dropZoneAbove = new DropZone(
         [...(parent?.getCoordinates() ?? [])],
         index
      );
      this.dropZoneService.addDropZone(this.dropZoneAbove);
   }

   private addDropZoneBelow(): void {
      if (this.branch === undefined) {
         throw new Error("failed to register drop zone below");
      }
      const parent = this.branch.getParent();
      const currentCoordinates = this.branch.getCoordinates();
      const index = currentCoordinates[currentCoordinates.length - 1];
      this.dropZoneBelow = new DropZone(
         [...(parent?.getCoordinates() ?? [])],
         index + 1
      );
      this.dropZoneService.addDropZone(this.dropZoneBelow);
   }

   private addDropZoneInside(): void {
      if (this.branch === undefined) {
         throw new Error("failed to register drop zone inside");
      }
      this.dropZoneInside = new DropZone([...this.branch.getCoordinates()], 0);
      this.dropZoneService.addDropZone(this.dropZoneInside);
   }

   private updateDropZones(): void {
      if (
         this.dropZoneAbove === undefined ||
         this.dropZoneBelow === undefined ||
         this.dropZoneInside === undefined
      ) {
         throw new Error("failed to update drop zones");
      }
      this.currentBranchCoordinates = this.branch?.getCoordinates();
      this.updateDropZoneAbove();
      this.updateDropZoneBelow();
      this.updateDropZoneInside();
      this.setDropZoneHosts();
   }

   private updateDropZoneAbove(): void {
      if (this.branch === undefined || this.dropZoneAbove === undefined) {
         throw new Error("failed to update drop zone above");
      }
      const parent = this.branch.getParent();
      const currentCoordinates = this.branch.getCoordinates();
      const index = currentCoordinates[currentCoordinates.length - 1];
      const location = this.dropZoneAbove.getLocation();
      location.setParentCoordinates([...(parent?.getCoordinates() ?? [])]);
      location.setInsertIndex(index);
   }

   private updateDropZoneBelow(): void {
      if (this.branch === undefined || this.dropZoneBelow === undefined) {
         throw new Error("failed to update drop zone below");
      }
      const parent = this.branch.getParent();
      const currentCoordinates = this.branch.getCoordinates();
      const index = currentCoordinates[currentCoordinates.length - 1];
      const location = this.dropZoneBelow.getLocation();
      location.setParentCoordinates([...(parent?.getCoordinates() ?? [])]);
      location.setInsertIndex(index + 1);
   }

   private updateDropZoneInside(): void {
      if (this.branch === undefined || this.dropZoneInside === undefined) {
         throw new Error("failed to update drop zone inside");
      }
      const location = this.dropZoneInside.getLocation();
      location.setParentCoordinates([...this.branch.getCoordinates()]);
   }

   private setDropZoneHosts() {
      if (
         this.dropZoneAbove === undefined ||
         this.dropZoneBelow === undefined
      ) {
         throw new Error("could not set drop zone hosts");
      }
      this.dropZoneAbove.setHost(this.parentHost);
      this.dropZoneBelow.setHost(this.parentHost);
   }

   private checkForHandle(): void {
      if (
         this.nodeHostContainer === undefined ||
         this.draggableDiv === undefined
      ) {
         return;
      }
      const nodeHostContainerElement = this.nodeHostContainer.nativeElement;
      const handle = nodeHostContainerElement.querySelector(
         ".limble-tree-handle"
      );
      const draggableDivElement = this.draggableDiv.nativeElement;
      if (!isDraggingAllowed(this.treeService.treeOptions, this.branch?.data)) {
         draggableDivElement.setAttribute("draggable", "false");
      } else if (handle === null) {
         draggableDivElement.setAttribute("draggable", "true");
      } else {
         handle.addEventListener("mousedown", () => {
            draggableDivElement.setAttribute("draggable", "true");
            //For some reason mouseup doesn't fire after a drag, so we use this observable sequence instead.
            const dragging = this.dragStateService.state$.pipe(
               filter((state) => state === "dragging"),
               first()
            );
            this.dragStateService.state$
               .pipe(
                  skipUntil(dragging),
                  filter((state) => state === "idle"),
                  first()
               )
               .subscribe(() => {
                  draggableDivElement.setAttribute("draggable", "false");
               });
         });
      }
   }
}
