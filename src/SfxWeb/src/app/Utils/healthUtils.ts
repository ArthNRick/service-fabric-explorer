import { IRawUnhealthyEvaluation, IRawHealthEvaluation } from '../Models/RawDataTypes';
import { HealthEvaluation } from '../Models/DataModels/Shared';
import { DataService } from '../services/data.service';

export class HealthUtils {
    public static getParsedHealthEvaluations(rawUnhealthyEvals: IRawUnhealthyEvaluation[], level: number = 0, parent: HealthEvaluation = null, data: DataService): HealthEvaluation[] {
        let healthEvals: HealthEvaluation[] = new Array(0);
        let children: HealthEvaluation[] = new Array(0);
        if (rawUnhealthyEvals) {
            rawUnhealthyEvals.forEach(item => {
                let healthEval: IRawHealthEvaluation = item.HealthEvaluation;
                let health = new HealthEvaluation(healthEval, level, parent);
                if (healthEval) {

                    //the parent Url is either the parent healthEvaluation or the current locationUrl if its the first parent.
                    let parentUrl = "";
                    if (parent) {
                        parentUrl = parent.viewPathUrl;
                    }else {
                        parentUrl = `${location.pathname}`; // TODO CHECK THIS works?
                    }
                    const pathData = HealthUtils.getViewPathUrl(healthEval, data, parentUrl);
                    health.viewPathUrl = pathData.viewPathUrl;
                    health.displayName =  pathData.displayName;
                    health.treeName = pathData.name;
                    health.uniqueId = pathData.uniqueId;
                    healthEvals.push(health);
                    healthEvals = healthEvals.concat(HealthUtils.getParsedHealthEvaluations(healthEval.UnhealthyEvaluations, level + 1, health, data));
                    children.push(health);
                }
            });
        }
        if (parent) {
            parent.children = children;
        }
        return healthEvals;
    }

    /**
     * Generates the url for a healthEvaluation to be able to route to the proper page. Urls are built up by taking the parentUrl and adding the minimum needed to route to this event.
     * Make sure that the application collection is initialized before calling this because for application kinds they make calls to the collection on the dataservice to get apptype.
     * @param healthEval
     * @param data
     * @param parentUrl
     */
    public static getViewPathUrl(healthEval: IRawHealthEvaluation, data: DataService, parentUrl: string = ""): {viewPathUrl: string, displayName: string, name: string, uniqueId: string } {
        let viewPathUrl = "";
        let name = "";
        let uniqueId = "";
        switch (healthEval.Kind) {
            case "Nodes" : {
                viewPathUrl = data.routes.getNodesViewPath();
                name = "Nodes";
                uniqueId = name;
                break;
            }
            case "Node" : {
                let nodeName = healthEval["NodeName"];
                name = nodeName;
                uniqueId = name;
                viewPathUrl = data.routes.getNodeViewPath(nodeName);
                break;
            }
            case "Applications" : {
                viewPathUrl = data.routes.getAppsViewPath();
                name = "applications"
                uniqueId = name;
                break;
            }
            case "Application" : {
                let applicationName = healthEval["ApplicationName"];
                let appName = applicationName.replace("fabric:/", ""); //remove fabric:/
                name = appName;
                uniqueId = applicationName;

                let app = data.apps.find(appName);
                if (app) {
                    let appType = app.raw.TypeName;
                    viewPathUrl += `/apptype/${data.routes.doubleEncode(appType)}/app/${data.routes.doubleEncode(appName)}`;
                }
                break;
            }
            case "Service" : {
                let exactServiceName = healthEval["ServiceName"].replace("fabric:/", "");

                name = exactServiceName;
                uniqueId = exactServiceName;

                //Handle system services slightly different by setting their exact path
                if (healthEval["ServiceName"].startsWith("fabric:/System")) {
                    viewPathUrl = `/apptype/System/app/System/service/${data.routes.doubleEncode(exactServiceName)}`;
                }else {
                    parentUrl += `/service/${data.routes.doubleEncode(exactServiceName)}`;
                    viewPathUrl = parentUrl;
                }
                break;
            }
            case "Partition" : {
                let partitionId = healthEval["PartitionId"];

                name = partitionId;
                uniqueId = partitionId;

                parentUrl += `/partition/${data.routes.doubleEncode(partitionId)}`;
                viewPathUrl = parentUrl;
                break;
            }
            case "Replica" : {
                let replicaId = healthEval["ReplicaOrInstanceId"];
                name = replicaId;
                uniqueId = replicaId;

                parentUrl += `/replica/${data.routes.doubleEncode(replicaId)}`;
                viewPathUrl = parentUrl;
                break;
            }
            case "Event" : {
                const source = healthEval['SourceId'];
                const property = healthEval['Property'];
                uniqueId = source + property;

                if (parentUrl) {
                    viewPathUrl = parentUrl;
                    uniqueId += parentUrl;
                }
                name = "Event";

                break;
            }

            case "DeployedApplication" : {
                const nodeName = healthEval["UnhealthyEvent"]["NodeName"];
                const applicationName = healthEval["UnhealthyEvent"]["Name"];
                const appName = applicationName.replace("fabric:/", "");
                name = appName;
                uniqueId = name;
                viewPathUrl += `/node/${data.routes.doubleEncode(nodeName)}/deployedapp/${data.routes.doubleEncode(appName)}`;
                break;
            }

            case "DeployedServicePackage" : {
                const serviceManifestName = healthEval["ServiceManifestName"];
                name = serviceManifestName;
                const activationId = healthEval["ServicePackageActivationId"];
                const activationIdUrlInfo =  activationId ? "activationid/" + data.routes.doubleEncode(activationId) : "";
                viewPathUrl = parentUrl + `/deployedservice/${activationIdUrlInfo}${serviceManifestName}`;
                name = serviceManifestName;
                break;
            }

            case "DeployedServicePackages" : {
                uniqueId = "DSP" + parentUrl;
            }
            case "Services" : {
                uniqueId = "SS" + healthEval["ServiceTypeName"]
            }
            case "Partitions" : {
                uniqueId = "PP" + parentUrl;
            }
            case "Replicas" : {
                uniqueId = "RR" + parentUrl;
            }

            default: {
                viewPathUrl = parentUrl;
                name = healthEval.Kind;
                break;
            }
        }
        // if (replaceText.length > 0) {
        //     healthEval.Description = Utils.injectLink(healthEval.Description, replaceText, viewPathUrl, replaceText);
        // }
        return {viewPathUrl, 
                displayName: "",
                name,
                uniqueId
               };
    }
}


export interface IUnhealthyEvaluationNode {
    healthEvaluation: HealthEvaluation;
    children: IUnhealthyEvaluationNode[];
    totalChildCount: number;
    parent: IUnhealthyEvaluationNode;
    containsErrorInPath: boolean;
  }
  
  
export const getNestedNode = (path: string[], root: IUnhealthyEvaluationNode) => {
    if (path.length >= 1) {
        const id = path.shift();
        const pathNode = root.children.find(node => node.healthEvaluation.uniqueId === id);
        if (pathNode) {

            if (path.length === 0) {
                return pathNode
            } else {
                return this.getNestedNode(path, pathNode);
            }
        } else {
            return null;
        }

    } else if (path.length === 0) {
        return root;
    }
}

export const getParentPath = (node: IUnhealthyEvaluationNode): IUnhealthyEvaluationNode[] => {
    let parents = [];

    let nodeRef = node;
    while (nodeRef.parent !== null) {
        parents.push(nodeRef.parent);
        nodeRef = nodeRef.parent;
    }
    console.log(parents)
    return parents.reverse();
}

export const getLeafNodes = (root: IUnhealthyEvaluationNode): IUnhealthyEvaluationNode[] => {
    if (root.children.length == 0) {
        return [root];
    } else {
        let nodes = [];
        root.children.forEach(node => { nodes = nodes.concat(getLeafNodes(node)) });
        return nodes;
    }
}

export const skipTreeDepthParentNode = (root: IUnhealthyEvaluationNode, depth: number = 1): IUnhealthyEvaluationNode[] => {
    if (depth <= 0) {
        console.log("test")
        return [root];
    } else {
        let nodes = [];
        root.children.forEach(node => { nodes = nodes.concat(skipTreeDepthParentNode(node, depth - 1)) });
        console.log(nodes)
        return nodes;
    }
}

export const recursivelyBuildTree = (healthEvaluation: HealthEvaluation, parent: IUnhealthyEvaluationNode = null): IUnhealthyEvaluationNode => {
    let curretNode: any = {};
    const children = [];
    let totalChildCount = 1;
    let containsErrorInPath = healthEvaluation.healthState.text === "Error";
    healthEvaluation.children.forEach(child => {
        const newNode = recursivelyBuildTree(child, curretNode);
        totalChildCount += newNode.totalChildCount;
        children.push(newNode)
        if (newNode.containsErrorInPath) {
            containsErrorInPath = true;
        }
    })

    //we use assign here so that we can pass the right reference above and then update the object back and still get proper type checking
    Object.assign(curretNode, <IUnhealthyEvaluationNode>{
        healthEvaluation,
        children,
        totalChildCount,
        parent,
        containsErrorInPath
    })
    return curretNode
}