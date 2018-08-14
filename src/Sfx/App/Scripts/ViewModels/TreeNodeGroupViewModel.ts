﻿//-----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation.  All rights reserved.
// Licensed under the MIT License. See License file under the project root for license information.
//-----------------------------------------------------------------------------

module Sfx {

    export class TreeNodeGroupViewModel {

        public children: TreeNodeViewModel[] = [];
        public loadingChildren: boolean = false;
        public childrenLoaded: boolean = false;
        public isChildrenSupportSearch?: boolean = false;
        public owningNode: TreeNodeViewModel;
        public childrenQuery: () => angular.IPromise<ITreeNode[]>;

        public get displayedChildren(): TreeNodeViewModel[] {
            let result = this.children;
            if (this.owningNode && this.owningNode.listSettings) {
                result = _.slice(result, this.owningNode.listSettings.begin, this.owningNode.listSettings.begin + this.owningNode.listSettings.limit);
            }
            return result;
        }

        public get hasChildren(): boolean {
            return !this.childrenLoaded || this.children.length !== 0;
        }

        public get isExpanded(): boolean {
            return this._isExpanded && this.hasChildren;
        }

        public get isCollapsed(): boolean {
            return !this._isExpanded && this.hasChildren;
        }

        public get paddingLeftPx(): string {
            if (this.owningNode) {
                return this.owningNode.paddingLeftPx;
            } else {
                return "45px";
            }
        }

        private _tree: TreeViewModel;
        private _isExpanded: boolean = false;
        private _currentGetChildrenPromise: angular.IPromise<any>;

        constructor(tree: TreeViewModel, owningNode: TreeNodeViewModel, childrenQuery: () => angular.IPromise<ITreeNode[]>, isChildrenSupportSearch?: boolean) {
            this._tree = tree;
            this.owningNode = owningNode;
            this.childrenQuery = childrenQuery;
            this.isChildrenSupportSearch = isChildrenSupportSearch;
        }

        public toggle(): angular.IPromise<any> {
            this._isExpanded = !this._isExpanded;
            return this._isExpanded ? this.getChildren() : this._tree.$q.when(true);
        }

        public expand(): angular.IPromise<any> {
            this._isExpanded = true;
            return this.getChildren();
        }

        public collapse() {
            this._isExpanded = false;
        }

        public pageDown() {
            if (!this.owningNode || !this.owningNode.listSettings) {
                return;
            }

            let listSettings = this.owningNode.listSettings;
            if (listSettings.currentPage < listSettings.pageCount) {
                listSettings.currentPage++;
            }
        }

        public pageUp() {
            if (!this.owningNode || !this.owningNode.listSettings) {
                return;
            }

            let listSettings = this.owningNode.listSettings;
            if (listSettings.currentPage > 1) {
                listSettings.currentPage--;
            }
        }

        public pageFirst() {
            if (!this.owningNode || !this.owningNode.listSettings) {
                return;
            }

            let listSettings = this.owningNode.listSettings;
            listSettings.currentPage = 1;
        }

        public pageLast() {
            if (!this.owningNode || !this.owningNode.listSettings) {
                return;
            }

            let listSettings = this.owningNode.listSettings;
            listSettings.currentPage = listSettings.pageCount;
        }

        public updateHealthChunkQueryRecursively(healthChunkQueryDescription: IClusterHealthChunkQueryDescription): void {
            if (!this._isExpanded) {
                return;
            }

            if (this.owningNode && this.owningNode.updateHealthChunkQueryDescription) {
                this.owningNode.updateHealthChunkQueryDescription(healthChunkQueryDescription);
            }

            _.forEach(this.children, child => {
                child.childGroupViewModel.updateHealthChunkQueryRecursively(healthChunkQueryDescription);
            });
        }

        public updateDataModelFromHealthChunkRecursively(clusterHealthChunk: IClusterHealthChunk): angular.IPromise<any> {
            if (!this._isExpanded) {
                return this._tree.$q.when(true);
            }

            return this._tree.$q.when(
                this.owningNode && this.owningNode.mergeClusterHealthStateChunk
                    ? this.owningNode.mergeClusterHealthStateChunk(clusterHealthChunk)
                    : true)
                .then(() => {
                    let updateChildrenPromises = _.map(this.children, child => {
                        return child.childGroupViewModel.updateDataModelFromHealthChunkRecursively(clusterHealthChunk);
                    });
                    return this._tree.$q.all(updateChildrenPromises);
                });
        }

        public refreshExpandedChildrenRecursively(): angular.IPromise<any> {
            if (!this.childrenQuery || !this._isExpanded) {
                return this._tree.$q.when(true);
            }

            return this.childrenQuery().then((response) => {
                let children = this.children;

                // Remove nodes that no longer exist
                for (let i = 0; i < children.length; i++) {
                    let node = children[i];
                    if (!node.nodeId) {
                        continue;
                    }

                    let exists = this.exists(response, node, (a, b) => a.nodeId === b.nodeId);
                    if (!exists) {
                        // Unselect removed node
                        if (this._tree.selectedNode && (node === this._tree.selectedNode || node.isParentOf(this._tree.selectedNode))) {
                            // Select the parent node instead
                            node.parent.select();
                        }
                        children.splice(i, 1);
                        i--;
                    }
                }

                // Clone children before adding new, to refresh recursively
                let childrenToRefresh = children.slice(0);

                // Add new nodes / update existing
                for (let i = 0; i < response.length; i++) {
                    let respNode = response[i];
                    if (!respNode.nodeId) {
                        continue;
                    }

                    let existing = this.exists(children, respNode, (a, b) => a.nodeId === b.nodeId ? a : null);
                    if (existing) {
                        // Update existing
                        existing.update(respNode);
                    } else {
                        // Add new
                        let newNode = new TreeNodeViewModel(this._tree, respNode, this.owningNode);

                        // Find the correct index in the sorted array
                        let index = _.sortedIndexBy(children, newNode, (item) => item.sortBy());
                        children.splice(index, 0, newNode);
                    }
                }

                // Recursively refresh children
                let promises: angular.IPromise<void>[] = [];
                childrenToRefresh.forEach(child => {
                    promises.push(child.childGroupViewModel.refreshExpandedChildrenRecursively());
                });

                // Update paging settings
                if (this.owningNode && this.owningNode.listSettings) {
                    this.owningNode.listSettings.count = this.children.length;
                }

                return this._tree.$q.all(promises);
            });
        }

        public searchThroughChildrenRecursively(serachTerm: string): angular.IPromise<any> {
            if (!this.childrenQuery || !this.isChildrenSupportSearch) {
                return this._tree.$q.when(true);
            }

            this.loadingChildren = true;
            return this.childrenQuery().then((response) => {
                let childrenViewModels: TreeNodeViewModel[] = [];
                for (let i = 0; i < response.length; i++) {
                    let node = response[i];
                    node.startExpanded = node.isChildrenSupportSearch;

                    // Node does not support search
                    if (!node.isChildrenSupportSearch && node.displayName().indexOf(serachTerm) < 0) {
                        continue;
                    }

                    childrenViewModels.push(new TreeNodeViewModel(this._tree, node, this.owningNode));
                }

                // Sort the children
                this.children = _.sortBy(childrenViewModels, (item) => item.sortBy());

                this.childrenLoaded = true;

                // Recursively refresh children
                let promises: angular.IPromise<void>[] = [];
                childrenViewModels.forEach(child => {
                    promises.push(child.childGroupViewModel.searchThroughChildrenRecursively(serachTerm));
                });

                return this._tree.$q.all(promises).then(() => {
                    this.children = _.filter(
                        this.children,
                        child => child.displayName().indexOf(serachTerm) >= 0 || (child.childGroupViewModel && child.childGroupViewModel.children && child.childGroupViewModel.children.length > 0));
                });
            }).finally(() => {
                if (this.owningNode && this.owningNode.listSettings) {
                    this.owningNode.listSettings.count = this.children.length;
                }

                this.loadingChildren = false;
            });
        }

        private getChildren(): angular.IPromise<any> {

            if (!this.childrenQuery || this.childrenLoaded) {
                return this._tree.$q.when(true);
            }

            if (!this._currentGetChildrenPromise) {
                this.loadingChildren = true;
                this._currentGetChildrenPromise = this.childrenQuery().then((response) => {
                    let childrenViewModels: TreeNodeViewModel[] = [];
                    for (let i = 0; i < response.length; i++) {
                        let node = response[i];
                        childrenViewModels.push(new TreeNodeViewModel(this._tree, node, this.owningNode));
                    }
                    // Sort the children
                    this.children = _.sortBy(childrenViewModels, (item) => item.sortBy());

                    this.childrenLoaded = true;
                }).finally(() => {
                    if (this.owningNode && this.owningNode.listSettings) {
                        this.owningNode.listSettings.count = this.children.length;
                    }

                    this._currentGetChildrenPromise = null;
                    this.loadingChildren = false;
                });
            }

            return this._currentGetChildrenPromise;
        }

        private exists(array: any[], item: any, comparer: (a: any, b: any) => any): any {
            for (let i = 0; i < array.length; i++) {
                let existing = comparer(array[i], item);
                if (existing) {
                    return existing;
                }
            }

            return false;
        }
    }
}
